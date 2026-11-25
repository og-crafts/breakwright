/** Locator repair without AI: match the failed locator with what is on the page now. */
export interface Suggestion { locator: string; score: number; why: string }
interface Item { role: string; name: string }
export function pageItems(yaml: string): Item[] {
  return [...yaml.matchAll(/^\s*-\s+'?(\w+)(?:\s+"((?:[^"\\]|\\.)*)")?/gm)].filter((m) => m[2]).map((m) => ({ role: m[1], name: m[2].replace(/\\"/g, '"').replace(/''/g, "'") }))
}
const grams = (s: string) => { const t = ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `; return new Set(Array.from({ length: Math.max(0, t.length - 1) }, (_, i) => t.slice(i, i + 2))) }
export function similar(a: string, b: string) { const x = grams(a), y = grams(b); if (!x.size || !y.size) return 0; let n = 0; for (const g of x) if (y.has(g)) n++; return (2 * n) / (x.size + y.size) }
const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
const FORM = new Set(['textbox', 'checkbox', 'combobox', 'radio', 'spinbutton', 'searchbox', 'slider', 'switch'])
/** Only same-role (or same kind) elements, and never a close tie: a wrong guess is worse than none. */
export function suggest(locator: string, yaml: string): Suggestion[] {
  const r = locator.match(/getByRole\(\s*['"`](\w+)['"`]\s*,\s*\{[^}]*name:\s*['"`](.+?)['"`]/), l = locator.match(/getBy(Label|Text|Placeholder)\(\s*['"`](.+?)['"`]/)
  if (!r && !l) return []
  const name = r ? r[2] : l![2], base = locator.slice(0, locator.indexOf('.getBy'))
  if (base !== 'page' && base !== '') return []
  const all = pageItems(yaml), count = (i: Item) => all.filter((x) => x.role === i.role && x.name === i.name).length
  const out = all.filter((i) => (r ? i.role === r[1] : l![1] === 'Text' || FORM.has(i.role)) && count(i) === 1).map((i) => ({ locator: FORM.has(i.role) && !r ? `page.getByLabel(${q(i.name)})` : `page.getByRole(${q(i.role)}, { name: ${q(i.name)} })`, score: similar(name, i.name), why: `${i.role} “${i.name}” is on the page; the test looks for “${name}”.` })).filter((s) => s.score >= 0.35).sort((a, b) => b.score - a.score)
  return out.length > 1 && out[0].score - out[1].score < 0.1 ? out.slice(0, 3) : out.slice(0, 1)
}
