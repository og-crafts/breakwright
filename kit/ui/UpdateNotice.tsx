import { app } from './app'
import type { Updates } from './useUpdates'
export function UpdateButton({ updates: u }: { updates: Updates }) {
  const v = u.available?.version
  if (!v) return null
  return <span className="k-row"><button type="button" className="k-btn small primary" disabled={u.busy} onClick={() => void u.install()}>{u.busy ? 'Updating…' : `Update to ${v}`}</button>
    <button type="button" className="k-icon" aria-label={`Dismiss update ${v}`} title="Not now" onClick={u.dismiss}>×</button></span>
}
export function UpdateNotice({ updates: u }: { updates: Updates }) {
  if (!u.noticeOpen) return null
  return <div className="k-notice" role="status"><span className="k-grow">{app().name} looks for new versions on GitHub. Nothing of yours is sent.</span>
    <button type="button" className="k-btn small ghost" onClick={() => u.answerNotice(false)}>Turn off</button>
    <button type="button" className="k-btn small" onClick={() => u.answerNotice(true)}>OK</button></div>
}
