/** What the kit needs to know about the app. Set once in main.tsx, before the first render. */
export interface Release { version: string; date: string; title: string; changes: string[] }
export interface AppInfo {
  name: string; slug: string; version: string; tagline: string; site: string; repo: string
  /** False when the page can't open a browser (no native commands): addresses are shown as text. */
  links?: boolean
  releases: Release[]; channel: 'release' | 'snapshot' | 'dev'
}
let info: AppInfo | null = null
export function setApp(a: AppInfo) { info = a }
export function app(): AppInfo { if (!info) throw new Error('setApp() was not called'); return info }
export const isDesktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
export async function native<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(cmd, args)
}
/** Opens a web address in the system browser. Rust refuses anything but https and mailto. */
export async function openExternal(url: string) {
  if (isDesktop()) await native('open_url', { url })
  else window.open(url, '_blank', 'noopener')
}
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
/** Device state: sizes, theme, update answers. Never user data, never synced. */
export const device = {
  get<T>(key: string, fallback: T): T {
    try { const v = localStorage.getItem(`${app().slug}.${key}`); return v === null ? fallback : (JSON.parse(v) as T) } catch { return fallback }
  },
  set(key: string, v: unknown) { try { localStorage.setItem(`${app().slug}.${key}`, JSON.stringify(v)) } catch { /* not remembered */ } },
}
