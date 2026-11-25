import { type ReactNode, useEffect, useRef, useState } from 'react'
import { device } from './app'
const MIN = 0.15, MAX = 0.85
const clamp = (n: number) => Math.min(MAX, Math.max(MIN, n))
export function useMedia(query: string): boolean {
  const get = () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches
  const [on, setOn] = useState(get)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const m = window.matchMedia(query); const f = () => setOn(m.matches)
    m.addEventListener('change', f); return () => m.removeEventListener('change', f)
  }, [query])
  return on
}
/** Two panes with a divider: drag, arrow keys, double-click to reset; remembered under `id`. Stacks on narrow windows. */
export function SplitPane({ id, label, first, second, start = 0.5 }: { id: string; label: string; first: ReactNode; second: ReactNode; start?: number }) {
  const wide = useMedia('(min-width: 1500px)'), narrow = useMedia('(max-width: 760px)')
  const [ratio, setRatio] = useState(() => { const n = Number(device.get(`split.${id}`, start)); return Number.isFinite(n) ? clamp(n) : start })
  const box = useRef<HTMLDivElement>(null), dragging = useRef(false)
  const set = (n: number) => { const r = clamp(n); setRatio(r); device.set(`split.${id}`, r) }
  if (narrow) return <div className="k-split"><div>{first}</div><div>{second}</div></div>
  const tracks = `minmax(0, ${ratio}fr) 10px minmax(0, ${1 - ratio}fr)`
  const at = (e: React.PointerEvent) => { const r = box.current!.getBoundingClientRect(); return wide ? (e.clientX - r.left) / r.width : (e.clientY - r.top) / r.height }
  const end = (e: React.PointerEvent, keep: boolean) => { if (!dragging.current) return; dragging.current = false; if (keep) set(at(e)) }
  return (
    <div ref={box} className={`k-split sized ${wide ? 'wide' : 'tall'}`} style={wide ? { gridTemplateColumns: tracks } : { gridTemplateRows: tracks }}>
      <div className="k-pane">{first}</div>
      <div className="k-splitter" role="separator" tabIndex={0} aria-orientation={wide ? 'vertical' : 'horizontal'} aria-label={label}
        aria-valuemin={MIN * 100} aria-valuemax={MAX * 100} aria-valuenow={Math.round(ratio * 100)} title="Drag to resize; double-click to reset"
        onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); dragging.current = true }}
        onPointerMove={(e) => { if (dragging.current) setRatio(clamp(at(e))) }}
        onPointerUp={(e) => end(e, true)} onPointerCancel={(e) => end(e, false)}
        onDoubleClick={() => set(start)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.03
          const to = ({ [wide ? 'ArrowLeft' : 'ArrowUp']: ratio - step, [wide ? 'ArrowRight' : 'ArrowDown']: ratio + step, Home: MIN, End: MAX } as Record<string, number>)[e.key]
          if (to !== undefined) { e.preventDefault(); set(to) }
        }} />
      <div className="k-pane">{second}</div>
    </div>
  )
}
