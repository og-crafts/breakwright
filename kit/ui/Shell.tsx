/** The family layout: top bar, rail, folding and resizable library, work area, status bar. */
import { type ReactNode, useState } from 'react'
import { app, device } from './app'
import { Icon, type IconName } from './Icons'
export interface Section { id: string; label: string; icon?: IconName; iconPath?: string; /** Shown in the library panel; a section without one opens a page. */ library?: ReactNode }
const MIN = 200, MAX = 640, START = 300
const clamp = (n: number) => Math.min(MAX, Math.max(MIN, n))
export function Shell({ sections, active, onPick, top, work, status, onBrand }: {
  sections: Section[]; active: string; onPick: (id: string) => void; top?: ReactNode; work: ReactNode; status?: ReactNode; onBrand?: () => void
}) {
  const [folded, setFolded] = useState(() => device.get('folded', false))
  const [width, setWidth] = useState(() => clamp(Number(device.get('sideWidth', START)) || START))
  const [drag, setDrag] = useState<{ x: number; w: number } | null>(null)
  const size = (n: number) => { const w = clamp(n); setWidth(w); device.set('sideWidth', w) }
  const fold = (f: boolean) => { setFolded(f); device.set('folded', f) }
  const open = sections.find((s) => s.id === active)
  const panel = open?.library !== undefined && !folded
  return (
    <div className="k-app">
      <header className="k-top"><button type="button" className="k-brand" onClick={onBrand}><img src="./icon.svg" alt="" width="22" height="22" />{app().name}</button>{top}</header>
      <div className="k-side" role="complementary" aria-label="Library">
        <nav className="k-rail" aria-label="Sections">
          {sections.map((s) => <button key={s.id} type="button" className={s.id === active ? 'on' : ''} aria-current={s.id === active ? 'page' : undefined}
            onClick={() => { if (s.id === active && s.library !== undefined) fold(!folded); else { if (s.library !== undefined) fold(false); onPick(s.id) } }}>
            <Icon name={s.icon} path={s.iconPath} /><span>{s.label}</span></button>)}
        </nav>
        {panel && <div className="k-library" style={{ width }}><h2>{open!.label}</h2>{open!.library}
          <div className="k-resizer" role="separator" tabIndex={0} aria-orientation="vertical" aria-label="Resize the library" aria-valuemin={MIN} aria-valuemax={MAX} aria-valuenow={width}
            onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); setDrag({ x: e.clientX, w: width }) }}
            onPointerMove={(e) => { if (drag) setWidth(clamp(drag.w + e.clientX - drag.x)) }}
            onPointerUp={(e) => { if (drag) { size(drag.w + e.clientX - drag.x); setDrag(null) } }} onPointerCancel={() => setDrag(null)}
            onDoubleClick={() => size(START)}
            onKeyDown={(e) => { const to = ({ ArrowLeft: width - (e.shiftKey ? 64 : 16), ArrowRight: width + (e.shiftKey ? 64 : 16), Home: MIN, End: MAX } as Record<string, number>)[e.key]; if (to !== undefined) { e.preventDefault(); size(to) } }} /></div>}
      </div>
      <main className="k-work">{work}</main>
      <footer className="k-status">{status}</footer>
    </div>
  )
}
