import { useEffect, useRef, useState } from 'react'
import { image } from './api'
export const VERDICT: Record<string, string> = { caught: 'Caught by a check', stopped: 'Stopped, but not by a check', missed: 'Missed', 'not-reached': 'Not reached', error: 'Couldn’t run' }
export function Strip({ list, total = 0, big }: { list: { verdict: string; label: string }[]; total?: number; big?: boolean }) {
  return <div className={`strip${big ? ' big' : ''}`} role="img" aria-label={`${list.filter((o) => o.verdict === 'caught').length} of ${Math.max(total, list.length)} faults caught`}>{list.map((o, i) => <i key={i} className={o.verdict} title={`${o.label}: ${VERDICT[o.verdict]}`} />)}{Array.from({ length: Math.max(0, total - list.length) }, (_, i) => <i key={`w${i}`} className="wait" />)}</div>
}
export function Diff({ before, after }: { before: string; after: string }) {
  const a = before.split('\n'), b = after.split('\n')
  let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++
  let e = 0; while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++
  const x = a.slice(s, a.length - e), y = b.slice(s, b.length - e), rows: [string, string][] = []
  if (x.length * y.length > 250_000) { x.forEach((l) => rows.push(['d', l])); y.forEach((l) => rows.push(['a', l])) } else {
    const L = Array.from({ length: x.length + 1 }, () => new Uint16Array(y.length + 1))
    for (let i = x.length - 1; i >= 0; i--) for (let j = y.length - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
    let i = 0, j = 0; while (i < x.length || j < y.length) if (i < x.length && j < y.length && x[i] === y[j]) { rows.push(['s', x[i]]); i++; j++ } else if (j >= y.length || (i < x.length && L[i + 1][j] >= L[i][j + 1])) rows.push(['d', x[i++]]); else rows.push(['a', y[j++]])
  }
  return <pre className="diff">{[...a.slice(Math.max(0, s - 2), s).map((l) => ['s', l]), ...rows, ...a.slice(a.length - e, a.length - e + 2).map((l) => ['s', l])].map(([k, l], i) => <div key={i} className={k}>{l || ' '}</div>)}</pre>
}
export function Shot({ rel }: { rel: string }) { const [u, set] = useState<string | null>(null); useEffect(() => { let url: string | null = null, off = false; void image(rel).then((x) => { url = x; if (off && x) URL.revokeObjectURL(x); else set(x) }); return () => { off = true; if (url) URL.revokeObjectURL(url) } }, [rel]); return u ? <img className="shot" src={u} alt="The page when the test failed" /> : null }
/** One long job at a time, with Stop. */
export function useJob(fail: (e: Error) => void) {
  const ref = useRef<AbortController | null>(null), [busy, set] = useState('')
  const go = async (name: string, f: (s: AbortSignal) => Promise<void>) => { if (ref.current) return; const c = new AbortController(); ref.current = c; set(name); try { await f(c.signal) } catch (e) { if (!c.signal.aborted) fail(e as Error) } finally { ref.current = null; set('') } }
  return { busy, go, stop: () => ref.current?.abort() }
}
