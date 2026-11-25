/** Runs the project's own Playwright and turns its JSON report into results with evidence. One run at a time. */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative, sep } from 'node:path'
import { dataDir, type Project } from './project'

export type Status = 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted'
export interface RunError { message: string; line?: number; file?: string; snippet?: string }
export interface Attempt { status: Status; ms: number; errors: RunError[]; attachments: { name: string; path?: string; type: string }[] }
export interface TestResult { started: string; file: string; line: number; title: string; project: string; status: Status; flaky: boolean; expected: boolean; attempts: Attempt[] }
export interface RunResult { id: string; at: string; ok: boolean; ms: number; results: TestResult[]; problem?: string; output: string; stopped?: boolean }
export interface Target { file: string; line?: number }
export interface RunOptions {
  targets?: Target[]; project?: string; repeat?: number; retries?: number; headed?: boolean; trace?: boolean; timeoutMs?: number; maxFailures?: number
  plan?: object; log?: string; env?: Record<string, string>; keep?: boolean; signal?: AbortSignal; onLine?: (s: string) => void; workers?: number
}

const here = dirname(fileURLToPath(import.meta.url))
export const preload = () => [join(here, 'preload.cjs'), join(here, '../inject/preload.cjs')].find(existsSync)!
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
let chain: Promise<unknown> = Promise.resolve()
let n = 0
/** Queue: two runs at once would fight over the project's web server and output. */
export function queued<T>(f: () => Promise<T>): Promise<T> { const p = chain.then(f, f); chain = p.catch(() => {}); return p }

/** Keys for assistants never reach the project under test. */
export function childEnv(extra: Record<string, string> = {}) {
  const env: Record<string, string | undefined> = { ...process.env, ...extra, FORCE_COLOR: '0', PLAYWRIGHT_HTML_OPEN: 'never' }
  for (const k of Object.keys(env)) if (/^(ANTHROPIC|OPENAI)_|^BREAKWRIGHT_(KEY|TOKEN)/.test(k)) delete env[k]
  return env
}
export const run = (p: Project, o: RunOptions = {}) => queued(() => runNow(p, o))

export async function runNow(p: Project, o: RunOptions = {}): Promise<RunResult> {
  const id = `${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${++n}`
  if (!p.cli || !p.config) return { id, at: new Date().toISOString(), ok: false, ms: 0, results: [], output: '', problem: p.problem }
  if (o.signal?.aborted) return { id, at: new Date().toISOString(), ok: false, ms: 0, results: [], output: '', problem: 'Stopped.', stopped: true }
  const dir = dataDir(p, 'runs', id), report = join(dir, 'report.json')
  const args = [p.cli, 'test', '--config', p.config, '--reporter=json', '--output', join(dir, 'out')]
  for (const t of o.targets ?? []) args.push(`(^|[\\\\/])${t.file.split('/').map(esc).join('[\\\\/]')}$${t.line ? `:${t.line}` : ''}`)
  if (o.project) args.push('--project', o.project)
  if (o.repeat) args.push('--repeat-each', String(o.repeat))
  if (o.retries !== undefined) args.push('--retries', String(o.retries))
  if (o.workers) args.push('--workers', String(o.workers))
  if (o.headed) args.push('--headed')
  if (o.timeoutMs) args.push('--timeout', String(o.timeoutMs))
  if (o.maxFailures) args.push('--max-failures', String(o.maxFailures))
  if (o.trace !== false) args.push('--trace', 'retain-on-failure')
  const env = childEnv({ ...o.env, PLAYWRIGHT_JSON_OUTPUT_FILE: report })
  if (o.plan || o.log) {
    env.NODE_OPTIONS = `${env.NODE_OPTIONS ?? ''} --require="${preload().split('\\').join('/')}"`.trim()
    if (o.plan) env.BREAKWRIGHT_PLAN = JSON.stringify(o.plan)
    if (o.log) env.BREAKWRIGHT_LOG = o.log
  }
  const t0 = Date.now()
  let output = '', stopped = false
  await new Promise<void>((done) => {
    const c = spawn(process.execPath, args, { cwd: p.root, env: env as NodeJS.ProcessEnv, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const kill = () => { stopped = true; c.kill('SIGINT'); setTimeout(() => c.kill('SIGKILL'), 8000).unref() }
    o.signal?.addEventListener('abort', kill, { once: true })
    const take = (b: Buffer) => { const s = b.toString(); output = (output + s).slice(-60_000); o.onLine?.(s) }
    c.stdout.on('data', take); c.stderr.on('data', take)
    c.on('error', (e) => { output += e.message; done() })
    c.on('close', () => { o.signal?.removeEventListener('abort', kill); done() })
  })
  const base = { id, at: new Date(t0).toISOString(), ms: Date.now() - t0, output, stopped }
  let json: any
  try { json = JSON.parse(readFileSync(report, 'utf8')) } catch { return { ...base, ok: false, results: [], problem: stopped ? 'Stopped.' : output.trim().slice(-1500) || 'Playwright ended without a report.' } }
  const results: TestResult[] = []
  const rootDir = json.config?.rootDir ?? p.root
  const visit = (s: any) => {
    for (const sp of s.specs ?? []) for (const t of sp.tests ?? []) {
      const attempts: Attempt[] = t.results.map((r: any) => ({ status: r.status, ms: r.duration, errors: (r.errors ?? []).map((e: any) => ({ message: cutSource(strip(e.message ?? '')), line: e.location?.line, file: e.location?.file, snippet: strip(e.snippet ?? '') })), attachments: (r.attachments ?? []).map((a: any) => ({ name: a.name, path: a.path, type: a.contentType })) }))
      const file = relative(p.root, join(rootDir, sp.file)).split(sep).join('/')
      results.push({ started: t.results[0]?.startTime ?? "", file, line: sp.line, title: sp.title, project: t.projectName, status: attempts.at(-1)?.status ?? 'skipped', flaky: t.status === 'flaky', expected: t.status === 'expected' || t.status === 'skipped', attempts })
    }
    for (const c of s.suites ?? []) visit(c)
  }
  ;(json.suites ?? []).forEach(visit)
  const problems = (json.errors ?? []).map((e: any) => strip(e.message ?? '')).join('\n')
  const res: RunResult = { ...base, ok: !stopped && !problems && results.length > 0 && results.every((r) => r.expected || r.flaky), results, problem: stopped ? 'Stopped.' : problems || (results.length ? undefined : 'No tests matched.') }
  if (o.keep === false) rmSync(dir, { recursive: true, force: true })
  else { writeFileSync(join(dir, 'result.json'), JSON.stringify(res)); prune(join(p.root, '.breakwright', 'runs')) }
  return res
}
/** Playwright puts source lines in the message; left in, a nearby expect( reads like a failed check. */
export const cutSource = (m: string) => m.split(/\n\s*>?\s*\d+ \|/)[0].trimEnd()
export const strip = (s: string) => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')
function prune(dir: string, keep = 40) { const all = readdirSync(dir).filter((d) => statSync(join(dir, d)).isDirectory()).sort(); for (const d of all.slice(0, -keep)) rmSync(join(dir, d), { recursive: true, force: true }) }
export function loadRun(p: Project, id: string): RunResult { if (!/^\d{14}-\d+$/.test(id)) throw new Error('Unknown run.'); return JSON.parse(readFileSync(join(p.root, '.breakwright', 'runs', id, 'result.json'), 'utf8')) }
export function listRuns(p: Project) { const d = join(p.root, '.breakwright', 'runs'); if (!existsSync(d)) return []; return readdirSync(d).filter((x) => existsSync(join(d, x, 'result.json'))).sort().reverse().slice(0, 40).map((x) => { const r = loadRun(p, x); return { id: r.id, at: r.at, ok: r.ok, ms: r.ms, total: r.results.length, failed: r.results.filter((t) => !t.expected && !t.flaky).length, problem: r.problem } }) }

/** Page snapshot Playwright saved when the test failed, if any. */
export function failurePage(t: TestResult): string {
  for (const a of t.attempts) for (const x of a.attachments) if (x.name === 'error-context' && x.path && existsSync(x.path)) { const m = readFileSync(x.path, 'utf8').match(/```yaml\n([\s\S]*?)```/); if (m) return m[1] }
  return ''
}
export interface Explanation { kind: string; summary: string; hint: string; error: string; page: string; line?: number }
/** A plain reading of the failure, with no AI. */
export function explain(t: TestResult): Explanation {
  const bad = t.attempts.find((a) => a.errors.length) ?? t.attempts[0]
  const e = bad?.errors[0]
  const m = e?.message ?? ''
  const page = failurePage(t)
  const r = (kind: string, summary: string, hint: string): Explanation => ({ kind, summary, hint, error: m.slice(0, 3000), page, line: e?.line })
  if (t.flaky) return r('flaky', 'Failed, then passed on a retry.', 'Run the flake lab to see what differs.')
  if (/strict mode violation/.test(m)) return r('ambiguous', 'The locator matches several elements.', 'Make it specific, for example by name or inside a region.')
  if (/net::ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(m)) return r('server-down', 'The app under test isn’t reachable.', 'Start it, or add webServer to the Playwright config.')
  if (/Executable doesn't exist|browserType\.launch/.test(m)) return r('no-browser', 'The browser isn’t installed or couldn’t start.', 'Run: npx playwright install')
  if (/element\(s\) not found|waiting for (locator|getBy)/.test(m) && !/resolved to/.test(m)) return r('not-found', 'The element wasn’t on the page.', 'Compare the locator with the page snapshot. It was renamed, removed, or never loaded.')
  if (/intercepts pointer events/.test(m)) return r('covered', 'Something covers the element.', 'Close the dialog or overlay first, as a person would.')
  if (/not (enabled|visible|stable|editable)/.test(m)) return r('not-ready', 'The element was there but not usable.', 'Check why it stays disabled or hidden.')
  if (/expect\(/.test(m)) return r('wrong-value', 'A check found a different value.', 'Decide which is right: the app or the expected value. This may be a real bug.')
  if (bad?.status === 'timedOut') return r('timeout', 'The test ran out of time.', 'Look at the last step it was waiting on.')
  return r('error', m.split('\n')[0] || 'The test failed.', 'Read the error below.')
}
