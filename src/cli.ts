import { parseArgs } from 'node:util'
import { writeFileSync } from 'node:fs'
import pkg from '../package.json'
import { audit } from './core/audit'
import { faultCheck, type FaultReport } from './core/faults'
import { flakeLab } from './core/flake'
import { serveMcp } from './core/mcp'
import { listSpecFiles, openProject, readSpec } from './core/project'
import { explain, run } from './core/run'
import { Inbox } from './core/signin'
import { startServer } from './server'

const HELP = `breakwright ${pkg.version} — know that your browser tests really test something

  breakwright open [folder]                   open the app in your browser
  breakwright run [folder] [file[:line]...]   run tests with a plain reading of each failure
  breakwright audit [folder]                  list weak spots (no code is run)
  breakwright faults [folder] <file:line>     break things on purpose; does the test notice?
  breakwright flake [folder] <file:line>      repeat a test, also on a slow network
  breakwright mcp [folder] [--allow run,propose,run-proposals] [--site <url>]   serve tools to AI assistants (stdio)
  breakwright inbox [--port 2525]             catch test e-mail on this computer

Options
  --max <n>         faults to try per test (default 12)     --repeat <n>   flake lab runs (default 10)
  --project <name>  Playwright project                      --json <file>  write the report
  --min-caught <p>  faults: exit 1 if fewer than p percent are caught
  --fail            audit: exit 1 when something is found
`
const { values: v, positionals } = parseArgs({ allowPositionals: true, options: { max: { type: 'string' }, repeat: { type: 'string' }, project: { type: 'string' }, json: { type: 'string' }, 'min-caught': { type: 'string' }, fail: { type: 'boolean' }, allow: { type: 'string' }, site: { type: 'string', multiple: true }, port: { type: 'string' }, 'print-url': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } })
const [cmd, ...rest] = positionals
const isSpec = (s: string) => /\.(spec|test)\.[cm]?[jt]sx?(:\d+)?$/.test(s)
const dir = rest[0] && !isSpec(rest[0]) ? rest[0] : '.'
const targets = rest.filter(isSpec).map((s) => { const m = s.match(/^(.*?)(?::(\d+))?$/)!; return { file: m[1], line: m[2] ? +m[2] : undefined } })
const out = (s = '') => process.stdout.write(s + '\n')
const stop = new AbortController()
process.on('SIGINT', () => { if (stop.signal.aborted) process.exit(130); stop.abort() })
const save = (d: unknown) => { if (v.json) writeFileSync(v.json, JSON.stringify(d, null, 2)) }
const proj = () => { const p = openProject(dir); if (p.problem) throw new Error(p.problem); return p }

async function main(): Promise<number> {
  if (!cmd || v.help) { out(HELP); return cmd ? 0 : 1 }
  if (cmd === 'open') {
    const s = await startServer({ port: v.port ? +v.port : 0, project: rest[0] })
    out(v['print-url'] ? JSON.stringify({ url: s.url }) : `Breakwright is open at ${s.url}\nPress Ctrl+C to stop.`)
    await new Promise<void>((d) => { stop.signal.addEventListener('abort', () => d()); process.on('SIGTERM', () => d()); if (v['print-url']) { process.stdin.resume(); process.stdin.on('end', () => d()) } })
    await s.close(); return 0
  }
  if (cmd === 'run') {
    const r = await run(proj(), { targets, project: v.project, signal: stop.signal })
    for (const t of r.results) { out(`${t.flaky ? 'FLAKY ' : t.expected ? 'ok    ' : 'FAILED'} ${t.file}:${t.line} ${t.title}`); if (!t.expected || t.flaky) { const x = explain(t); out(`       ${x.summary} ${x.hint}\n       ${x.error.split('\n')[0]}`) } }
    if (r.problem) out(r.problem); save(r); return r.ok ? 0 : 1
  }
  if (cmd === 'audit') {
    const p = openProject(dir); let n = 0; const all: object[] = []
    for (const f of listSpecFiles(p)) { const s = readSpec(p, f); if (s.error) { out(`${f}: ${s.error}`); n++; continue } for (const x of audit(s.src)) { n++; all.push({ file: f, ...x }); out(`${f}:${x.line} ${x.rule}: ${x.message}`) } }
    out(n ? `${n} found` : 'Nothing found'); save(all); return n && v.fail ? 1 : 0
  }
  if (cmd === 'faults') {
    const p = proj()
    const list = targets.length ? targets.flatMap((t) => (t.line ? [t] : readSpec(p, t.file).tests!.map((x) => ({ file: t.file, line: x.line })))) : listSpecFiles(p).flatMap((f) => (readSpec(p, f).tests ?? []).map((x) => ({ file: f, line: x.line })))
    const reps: FaultReport[] = []
    for (const t of list) { if (stop.signal.aborted) break; out(`\n${t.file}:${t.line}`); const r = await faultCheck(p, t, { max: v.max ? +v.max : undefined, project: v.project, signal: stop.signal, onProgress: (_d, _t, o) => { if (o) out(`  ${o.verdict.padEnd(11)} ${o.label}`) } }); reps.push(r); out(`  ${r.title ?? ''}: ${r.caught} of ${r.tried} caught by a check${r.skipped ? `, ${r.skipped} not tried` : ''}${r.note ? `\n  ${r.note}` : ''}`) }
    save(reps)
    const tried = reps.reduce((a, r) => a + r.tried, 0), caught = reps.reduce((a, r) => a + r.caught, 0)
    const bad = stop.signal.aborted || reps.some((r) => r.baseline !== 'passed')
    return bad || (v['min-caught'] !== undefined && (!tried || (100 * caught) / tried < +v['min-caught'])) ? 1 : 0
  }
  if (cmd === 'flake') { if (!targets[0]) throw new Error('Name a test: file:line'); const r = await flakeLab(proj(), targets[0], { repeat: v.repeat ? +v.repeat : undefined, project: v.project, signal: stop.signal }); for (const x of r.runs) { out(`${x.condition}: ${x.passed} passed, ${x.failed} failed (${x.msMin}–${x.msMax} ms)`); for (const e of x.errors) out(`  ${e.count}× line ${e.line}: ${e.message.split('\n')[0]}`) } out(r.verdict); save(r); return r.runs.some((x) => x.failed) ? 1 : 0 }
  if (cmd === 'mcp') { const a = new Set((v.allow ?? '').split(',').map((s) => s.trim())); await serveMcp(openProject(dir), { run: a.has('run'), propose: a.has('propose'), runProposals: a.has('run-proposals'), sites: a.has('run') ? v.site ?? [] : [] }, pkg.version); return 0 }
  if (cmd === 'inbox') { const i = new Inbox(); out(`Catching mail on 127.0.0.1:${await i.start(v.port ? +v.port : 2525)}`); let n = 0; const t = setInterval(() => { for (const m of i.mails.filter((x) => x.id > n)) { n = m.id; out(`${m.to.join(', ')}: ${m.subject} ${m.codes.join(' ')} ${m.links.join(' ')}`) } }, 500); await new Promise<void>((d) => stop.signal.addEventListener('abort', () => d())); clearInterval(t); i.stop(); return 0 }
  out(HELP); return 1
}
main().then((c) => process.exit(c), (e) => { process.stderr.write(`${(e as Error).message}\n`); process.exit(1) })
