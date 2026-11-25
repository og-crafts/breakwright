/** Flake lab: repeat a test as it is, then with a slow network, and compare. */
import type { Project } from './project'
import { queued, runNow, type Target } from './run'
export interface FlakeReport { title: string; runs: { condition: 'normal' | 'slow network'; passed: number; failed: number; errors: { message: string; count: number; line?: number }[]; msMin: number; msMax: number }[]; verdict: string }
export const flakeLab = (p: Project, target: Target, o: { repeat?: number; project?: string; signal?: AbortSignal } = {}) => queued(async (): Promise<FlakeReport> => {
  const runs: FlakeReport['runs'] = []; let title = ''
  for (const condition of ['normal', 'slow network'] as const) {
    const r = await runNow(p, { targets: [target], project: o.project, retries: 0, repeat: condition === 'normal' ? o.repeat ?? 10 : Math.max(3, Math.ceil((o.repeat ?? 10) / 3)), workers: 1, trace: false, keep: false, signal: o.signal, ...(condition === 'normal' ? {} : { plan: { fault: { kind: 'slow', ms: 1200 } } }) })
    if (!r.results.length) throw new Error(r.problem ?? 'The test didn’t run.')
    title = r.results[0].title
    const errs = new Map<string, { message: string; count: number; line?: number }>()
    for (const t of r.results) { const e = t.attempts[0]?.errors[0]; if (t.status === 'passed' || !e) continue; const k = e.message.split('\n')[0] + e.line; const x = errs.get(k) ?? { message: e.message.slice(0, 400), count: 0, line: e.line }; x.count++; errs.set(k, x) }
    const ms = r.results.map((t) => t.attempts[0]?.ms ?? 0)
    runs.push({ condition, passed: r.results.filter((t) => t.status === 'passed').length, failed: r.results.filter((t) => !['passed', 'skipped'].includes(t.status)).length, errors: [...errs.values()].sort((a, b) => b.count - a.count), msMin: Math.min(...ms), msMax: Math.max(...ms) })
    if (o.signal?.aborted) break
  }
  const [a, b] = runs
  const verdict = o.signal?.aborted ? 'Stopped.' : a.failed && a.passed ? 'Flaky: it fails some of the time with nothing changed.' : a.failed ? 'It fails every time, so it is broken rather than flaky.' : b?.failed ? 'Steady here, but it breaks on a slow network. It may fail in CI.' : `Steady in ${a.passed + (b?.passed ?? 0)} runs. That lowers the odds of a flake; it doesn’t rule one out.`
  return { title, runs, verdict }
})
