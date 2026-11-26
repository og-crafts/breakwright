import { useCallback, useEffect, useRef, useState } from 'react'
/** Opens the dialog, then focuses its `data-focus` element: showModal() would take the first control, whatever React's autoFocus said. */
export function useModal() {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => { const d = ref.current; if (d && !d.open) { if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', ''); d.querySelector<HTMLElement>('[data-focus]')?.focus() } }, [])
  return ref
}
/** The caller names the button and says when it is dangerous; nothing is guessed from the message. */
export interface ConfirmOptions { message: string; ok: string; danger?: boolean }
export interface AskOptions { title: string; initial?: string; ok?: string }
type Pending = ({ kind: 'confirm'; resolve: (v: boolean) => void } & ConfirmOptions) | ({ kind: 'ask'; resolve: (v: string | null) => void } & AskOptions)
/** Promise dialogs on a native <dialog>. One that another replaces counts as cancelled, so its caller goes on. */
export function useDialogs() {
  const [pending, show] = useState<Pending | null>(null)
  const current = useRef<Pending | null>(null), count = useRef(0)
  const open = useCallback((p: Pending | null) => {
    const old = current.current; current.current = p; count.current++; show(p)
    if (p && old) { if (old.kind === 'confirm') old.resolve(false); else old.resolve(null) }
  }, [])
  const confirm = useCallback((o: ConfirmOptions) => new Promise<boolean>((resolve) => open({ kind: 'confirm', resolve, ...o })), [open])
  const ask = useCallback((o: AskOptions) => new Promise<string | null>((resolve) => open({ kind: 'ask', resolve, ...o })), [open])
  return { confirm, ask, node: pending ? <Dialog key={count.current} p={pending} close={() => open(null)} /> : null }
}
function Dialog({ p, close }: { p: Pending; close: () => void }) {
  const ref = useModal()
  const [text, setText] = useState(p.kind === 'ask' ? p.initial ?? '' : '')
  const finish = (ok: boolean) => { ref.current?.close?.(); close(); if (p.kind === 'confirm') p.resolve(ok); else p.resolve(ok && text.trim() ? text.trim() : null) }
  const danger = p.kind === 'confirm' && p.danger
  return (
    <dialog ref={ref} className="k-dialog" aria-label={p.kind === 'ask' ? p.title : p.message.split('\n')[0]} onCancel={(e) => { e.preventDefault(); finish(false) }}>
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); finish(true) }}>
        {p.kind === 'confirm' ? <p>{p.message}</p> : <label className="k-field"><span>{p.title}</span><input data-focus value={text} onChange={(e) => setText(e.target.value)} /></label>}
        <div className="k-actions end">
          <button type="button" className="k-btn ghost" data-focus={danger || undefined} onClick={() => finish(false)}>Cancel</button>
          <button type="submit" data-focus={p.kind === 'confirm' && !danger ? true : undefined} className={`k-btn ${danger ? 'danger' : 'primary'}`}>{p.ok ?? 'OK'}</button>
        </div>
      </form>
    </dialog>
  )
}
