// Plants each bug and runs each suite: which suites notice? Then compares with their fault-check scores.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
const bugs = JSON.parse(readFileSync('examples/shop/bugs.json')), cli = 'node_modules/@playwright/test/cli.js', cwd = 'examples/shop'
const run = (bug) => { const r = spawnSync(process.execPath, ['../../' + cli, 'test', '--reporter=json', '--output', '.breakwright/bench'], { cwd, env: { ...process.env, BUG: bug, PORT: '4188', PLAYWRIGHT_JSON_OUTPUT_FILE: '' }, encoding: 'utf8', maxBuffer: 5e7 }); const j = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))); const o = {}; for (const s of j.suites) o[s.file.replace('.spec.ts', '')] = s.specs.every((x) => x.ok); return o }
const clean = run(''); if (!Object.values(clean).every(Boolean)) throw new Error('Not clean: ' + JSON.stringify(clean))
const rows = bugs.map((b) => { const r = run(b); const noticed = Object.fromEntries(Object.entries(r).map(([k, ok]) => [k, !ok])); console.log(b.padEnd(22), JSON.stringify(noticed)); return { bug: b, noticed } })
const faults = {}
for (const s of Object.keys(clean)) { const f = `/tmp/breakwright-bench-${s}.json`; try { execFileSync(process.execPath, ['../../dist/cli.mjs', 'faults', `tests/${s}.spec.ts`, '--max', '20', '--json', f], { cwd, env: { ...process.env, PORT: '4188' }, stdio: 'ignore' }) } catch { /* exit code 1 when a baseline fails; read the report */ } const r = JSON.parse(readFileSync(f)); faults[s] = { caught: r.reduce((a, x) => a + x.caught, 0), tried: r.reduce((a, x) => a + x.tried, 0), untrusted: r.filter((x) => x.baseline !== 'passed').length, ms: r.reduce((a, x) => a + x.ms, 0), tests: r.length } }
const out = { suites: Object.fromEntries(Object.keys(clean).map((s) => [s, { bugsNoticed: rows.filter((r) => r.noticed[s]).length, of: bugs.length, faults: faults[s] }])), rows }
writeFileSync('docs/benchmark.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify(out.suites, null, 1))
