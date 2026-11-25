// Bundles each test with esbuild and runs it on Node's own test runner (light on memory).
import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
const only = process.argv[2]
const files = readdirSync('tests').filter((f) => f.endsWith('.test.ts') && (!only || f.includes(only)))
rmSync('dist/tests', { recursive: true, force: true }); mkdirSync('dist/tests', { recursive: true })
await build({ entryPoints: files.map((f) => `tests/${f}`), bundle: true, platform: 'node', format: 'esm', target: 'node22', outdir: 'dist/tests', outExtension: { '.js': '.mjs' }, banner: { js: "import{createRequire as __cr}from'node:module';const require=__cr(import.meta.url);" }, logLevel: 'warning' })
copyFileSync('src/inject/preload.cjs', 'dist/tests/preload.cjs')
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter=spec', ...files.map((f) => `dist/tests/${f.replace('.ts', '.mjs')}`)], { stdio: 'inherit' })
process.exit(r.status ?? 1)
