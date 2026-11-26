import { useState } from 'react'
import { device } from './app'
export type Theme = 'system' | 'light' | 'dark'
const KNOWN: Theme[] = ['system', 'light', 'dark']
/** A saved theme this version does not know falls back to the system's. */
export function applyTheme(t: Theme) {
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t)
  else document.documentElement.removeAttribute('data-theme')
}
export function savedTheme(): Theme { const t = device.get<Theme>('theme', 'system'); return KNOWN.includes(t) ? t : 'system' }
export function useTheme() {
  const [theme, set] = useState(savedTheme)
  return { theme, setTheme: (t: Theme) => { set(t); applyTheme(t); device.set('theme', t) } }
}
