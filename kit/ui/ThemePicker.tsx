import type { Theme } from './theme'
const LABEL: Record<Theme, string> = { system: 'Follow the system', light: 'Light', dark: 'Dark' }
export function ThemePicker({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  return (
    <div className="k-segmented" role="radiogroup" aria-label="Theme">
      {(Object.keys(LABEL) as Theme[]).map((t) => (
        <label key={t} className={theme === t ? 'on' : ''}>
          <input type="radio" name="theme" checked={theme === t} onChange={() => setTheme(t)} />{LABEL[t]}
        </label>
      ))}
    </div>
  )
}
