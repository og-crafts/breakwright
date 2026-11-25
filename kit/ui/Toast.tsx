import { useCallback, useEffect, useState } from 'react'
export interface ToastAction { label: string; run: () => void }
export type Notify = (text: string, action?: ToastAction) => void
export function useToast() {
  const [t, set] = useState<{ text: string; action?: ToastAction; id: number } | null>(null)
  const notify: Notify = useCallback((text, action) => set((o) => ({ text, action, id: (o?.id ?? 0) + 1 })), [])
  useEffect(() => { if (!t) return; const h = setTimeout(() => set(null), t.action ? 10_000 : 5_000); return () => clearTimeout(h) }, [t])
  const node = (
    <div role="status" aria-live="polite">{t && <div className="k-toast" key={t.id}><span>{t.text}</span>
      {t.action && <button type="button" className="k-btn small primary" onClick={() => { t.action!.run(); set(null) }}>{t.action.label}</button>}
      <button type="button" className="k-icon" aria-label="Dismiss" onClick={() => set(null)}>×</button></div>}</div>
  )
  return { notify, node }
}
