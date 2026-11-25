import { app, isDesktop, openExternal } from './app'
import { useModal } from './Dialogs'
import type { Notify } from './Toast'
export function versionLine() {
  const a = app(); const c = { release: '', snapshot: ' (snapshot)', dev: ' (development build)' }[a.channel]
  return `${a.name} ${a.version}${c}, ${isDesktop() ? 'desktop' : 'web'} app`
}
/** `code` and **bold** are the only markup a changelog item uses. */
export function Inline({ text }: { text: string }) {
  return <>{text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).filter(Boolean).map((p, i) =>
    p.length > 2 && p.startsWith('`') && p.endsWith('`') ? <code key={i}>{p.slice(1, -1)}</code>
      : p.length > 4 && p.startsWith('**') && p.endsWith('**') ? <b key={i}>{p.slice(2, -2)}</b> : <span key={i}>{p}</span>)}</>
}
export function AboutDialog({ onClose, notify }: { onClose: () => void; notify: Notify }) {
  const ref = useModal(), a = app()
  const links: [string, string][] = [['Website', a.site], ['Source code', `https://github.com/${a.repo}`]]
  const copy = async () => { try { await navigator.clipboard.writeText(versionLine()); notify('Version copied.') } catch { notify(versionLine()) } }
  return (
    <dialog ref={ref} className="k-dialog wide" aria-labelledby="k-about" onClose={onClose}>
      <div className="k-row"><img src="./icon.svg" alt="" width="48" height="48" />
        <div className="k-grow"><h2 id="k-about">{a.name}</h2><p className="k-muted k-small">{versionLine()}</p></div>
        <button type="button" className="k-btn small ghost" onClick={() => void copy()}>Copy version</button></div>
      <p className="k-muted">{a.tagline}</p>
      <p className="k-row">{links.map(([l, u]) => a.links === false ? <span key={u} className="k-muted">{u}</span> : <button key={u} type="button" className="k-link" onClick={() => void openExternal(u)}>{l}</button>)}</p>
      <h3>What’s new</h3>
      <div className="k-releases" tabIndex={0} aria-label="Changes in each release">
        {a.releases.map((r, i) => <details key={r.version} open={i === 0}>
          <summary><b>{r.version}</b> <span className="k-muted">{r.date}</span>{r.version === a.version && <span className="k-muted"> · this version</span>}</summary>
          <p>{r.title}</p><ul>{r.changes.map((c) => <li key={c}><Inline text={c} /></li>)}</ul>
        </details>)}
      </div>
      <div className="k-actions end"><button type="button" className="k-btn primary" data-focus onClick={() => ref.current?.close?.()}>Close</button></div>
    </dialog>
  )
}
