/** Fault check: break one thing at a time and see whether the test notices. */
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { dataDir, type Project } from './project'
import { queued, runNow, type Target, type TestResult } from './run'

export type FaultKind = 'fail' | 'change' | 'empty' | 'dead-action'
export interface Fault { kind: FaultKind; key: string }
/** caught: a check failed. stopped: a step couldn't go on (it noticed, but not through a check). missed: still green. */
export type Verdict = 'caught' | 'stopped' | 'missed' | 'not-reached' | 'error'
export interface FaultOutcome extends Fault { verdict: Verdict; label: string; detail: string }
export interface FaultReport { target: Target; title: string; baseline: 'passed' | 'failed' | 'flaky'; outcomes: FaultOutcome[]; caught: number; tried: number; skipped: number; ms: number; note?: string; stopped?: boolean }

const LABEL: Record<FaultKind, (k: string) => string> = { fail: (k) => `${k} fails with 500`, change: (k) => `${k} returns changed values`, empty: (k) => `${k} returns nothing`, 'dead-action': (k) => `Clicking ${k} does nothing` }
export interface Seen { t: string; key?: string; json?: boolean; status?: number; i?: number; id?: string }
export function readLog(f: string): Seen[] { return existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)] } catch { return [] } }) : [] }

/** Faults worth trying for what the test touched: what it changed first, page loads later. */
export function planFaults(seen: Seen[], max = 12): { faults: Fault[]; skipped: number } {
  const clicks = [...new Set(seen.filter((s) => s.t === 'click').map((s) => s.key!))]
  const apis = new Map<string, Seen>(); for (const s of seen) if (s.t === 'api' && (s.status ?? 0) < 400) apis.set(s.key!, s)
  const write = [...apis.values()].filter((s) => !s.key!.startsWith('GET ')), read = [...apis.values()].filter((s) => s.key!.startsWith('GET '))
  const data = (s: Seen): Fault[] => s.json ? [{ kind: 'change', key: s.key! }] : []
  const all: Fault[] = [
    ...clicks.map((key): Fault => ({ kind: 'dead-action', key })),
    ...write.flatMap((s): Fault[] => [{ kind: 'fail', key: s.key! }, ...data(s)]),
    ...read.flatMap((s): Fault[] => [...data(s), { kind: 'fail', key: s.key! }, ...(s.json ? [{ kind: 'empty' as const, key: s.key! }] : [])]),
  ]
  return { faults: all.slice(0, max), skipped: Math.max(0, all.length - max) }
}
export function judge(t: TestResult | undefined, hit: boolean): { verdict: Verdict; detail: string } {
  if (!t) return { verdict: 'error', detail: 'The test didn’t run.' }
  if (!hit) return { verdict: 'not-reached', detail: 'The test never reached this, so nothing was proved.' }
  if (t.status === 'passed') return { verdict: 'missed', detail: 'The test still passed.' }
  const m = t.attempts.flatMap((a) => a.errors).map((e) => e.message).find(Boolean) ?? ''
  return /\bexpect(\.soft)?\(|toPass|AssertionError/.test(m) ? { verdict: 'caught', detail: m.split('\n')[0] } : { verdict: 'stopped', detail: m.split('\n')[0] || t.status }
}
export interface FaultOptions { max?: number; project?: string; signal?: AbortSignal; onProgress?: (done: number, total: number, o?: FaultOutcome) => void }
export const faultCheck = (p: Project, target: Target, o: FaultOptions = {}) => queued(() => checkNow(p, target, o))

async function checkNow(p: Project, target: Target, o: FaultOptions): Promise<FaultReport> {
  const t0 = Date.now()
  const log = join(dataDir(p, 'tmp'), `${process.pid}-${t0}.log`)
  const go = async (plan: object, repeat: number) => {
    rmSync(log, { force: true })
    const r = await runNow(p, { targets: [target], project: o.project, retries: 0, repeat, workers: 1, trace: false, keep: false, plan, log, signal: o.signal })
    return { r, results: r.results.filter((x) => !target.line || x.line === target.line), seen: readLog(log) }
  }
  const done = (x: Partial<FaultReport>): FaultReport => { rmSync(log, { force: true }); const outcomes = x.outcomes ?? []; return { target, title: '', baseline: 'failed', skipped: 0, ...x, outcomes, caught: outcomes.filter((f) => f.verdict === 'caught').length, tried: outcomes.filter((f) => ['caught', 'stopped', 'missed'].includes(f.verdict)).length, ms: Date.now() - t0 } }
  const base = await go({}, 1), t = base.results[0]
  if (!t || t.status !== 'passed') return done({ title: t?.title, note: base.r.problem ?? 'The test fails without any fault. Fix it first.' })
  const title = t.title
  if (base.results.length > 1) return done({ title, baseline: 'passed', note: `This matches ${base.results.length} tests (several browsers or parameters). Choose one project.` })
  if (!base.seen.some((x) => x.t === 'attached')) return done({ title, baseline: 'passed', note: `Couldn’t watch this test: the check didn’t attach to Playwright on Node ${process.version}. Nothing was proved. Try a newer Node.` })
  const { faults, skipped } = planFaults(base.seen, o.max)
  if (!faults.length) return done({ title, baseline: 'passed', note: 'No clicks or API calls were seen, so there was nothing to break.' })
  o.onProgress?.(0, faults.length)
  let n = 0
  const timer = setInterval(() => { const at = Math.max(-1, ...readLog(log).map((s) => s.i ?? -1)); if (at > n) o.onProgress?.((n = Math.min(at, faults.length)), faults.length) }, 1000)
  // One Playwright session: repeat i runs with fault i, the last repeat runs clean.
  const all = await go({ faults }, faults.length + 1).finally(() => clearInterval(timer))
  // One worker runs the repeats in order. A repeat without its own context mark, or a missing one, is never judged.
  const order = all.results.filter((x) => x.started).sort((x, y) => x.started.localeCompare(y.started))
  const ran = (i: number) => all.seen.some((s) => s.t === 'ctx' && s.i === i)
  const byFault = (i: number) => (order.length === faults.length + 1 && ran(i) ? order[i] : undefined)
  if (o.signal?.aborted) return done({ title, baseline: 'passed', skipped: skipped + faults.length, stopped: true, note: 'Stopped.' })
  const outcomes = faults.map((f, i): FaultOutcome => ({ ...f, label: LABEL[f.kind](f.key), ...judge(byFault(i), all.seen.some((s) => s.t === 'hit' && s.i === i)) }))
  // 'proved' only if the test still passes clean at the end, in the same session.
  const steady = byFault(faults.length)?.status === 'passed'
  if (!steady) for (const x of outcomes) if (x.verdict !== 'not-reached') { x.verdict = 'error'; x.detail = 'Not counted: the test wasn’t steady.' }
  outcomes.forEach((x, i) => o.onProgress?.(i + 1, faults.length, x))
  return done({ title, baseline: steady ? 'passed' : 'flaky', outcomes, skipped, note: steady ? undefined : all.r.problem ?? 'The test also failed with no fault at the end. It may depend on data left by an earlier run, so these results can’t be trusted.' })
}
