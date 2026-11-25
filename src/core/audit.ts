/** Static review of a spec (what looks weak) and the guard (what a change would weaken). */
import { similar } from './suggest'
import { ast, calleeName, parseSpec, tokens, type Spec, type Step, type TestInfo } from './steps'

export interface Finding { rule: string; message: string; test?: string; line: number }
type Node = any
const each = (n: Node, f: (n: Node, parents: Node[]) => void, parents: Node[] = []) => {
  if (!n || typeof n !== 'object') return
  if (Array.isArray(n)) { n.forEach((x) => each(x, f, parents)); return }
  if (typeof n.type === 'string') f(n, parents)
  const next = typeof n.type === 'string' ? [...parents, n] : parents
  for (const k in n) if (!['loc', 'leadingComments', 'trailingComments', 'innerComments'].includes(k)) { const v = n[k]; if (v && typeof v === 'object') each(v, f, next) }
}
const root = (n: Node): Node => { let x = n; while (x && (x.type === 'MemberExpression' || x.type === 'CallExpression')) x = x.type === 'MemberExpression' ? x.object : x.callee; return x }

/** expect calls in a subtree: matcher, text of target and arguments */
export interface Assertion { matcher: string; target: string; args: string; not: boolean; awaited: boolean; soft: boolean; line: number; start: number }
export function assertions(src: string, from = 0, to = src.length): Assertion[] {
  const out: Assertion[] = []
  each(ast(src).program, (n, parents) => {
    if (n.type !== 'CallExpression' || n.start < from || n.end > to || n.callee.type !== 'MemberExpression' || n.callee.computed) return
    const name = n.callee.property.name; if (!/^to[A-Z]/.test(name)) return
    let o = n.callee.object, not = false
    while (o.type === 'MemberExpression') { if (o.property.name === 'not') not = true; o = o.object }
    if (o.type !== 'CallExpression') return
    const r = root(o); if (!(r?.type === 'Identifier' && r.name === 'expect')) return
    const p = parents.at(-1)
    out.push({ matcher: name, target: o.arguments[0] ? src.slice(o.arguments[0].start, o.arguments[0].end) : '', args: n.arguments.map((a: Node) => src.slice(a.start, a.end)).join(', '), not, soft: calleeName(o.callee) === 'expect.soft', awaited: ['AwaitExpression', 'ReturnStatement', 'ArrowFunctionExpression'].includes(p?.type), line: n.loc.start.line, start: n.start })
  })
  return out
}
const WEAK = new Set(['toBeVisible', 'toBeAttached', 'toBeTruthy', 'toBeDefined', 'toHaveURL', 'toHaveTitle', 'toBeInViewport', 'toBeEnabled'])
/** Seeing a particular text or name is a real check; so is a helper that checks. */
const NAMED = /getBy(Text|AltText|Title)\(|\bname:|hasText|:has-text|text=|getByRole\([^)]*,|^[a-zA-Z_$][\w$.]*$(?<!^page)/
const HELPER = /\b(?!expect\s*[.(])(?:\w+\.)*(?:expect|assert|verify|check)[A-Z_]\w*\s*\(/
const WEB = /^(toBe(Visible|Hidden|Enabled|Disabled|Checked|Attached|Editable|Empty|Focused|InViewport)|toHave(Text|URL|Title|Count|Value|Values|Attribute|Class|CSS|Id|Screenshot|Role|AccessibleName|AccessibleDescription|JSProperty)|toContainText|toContainClass|toMatchAriaSnapshot|toPass)$/

export function audit(src: string): Finding[] {
  const out: Finding[] = []
  const spec = parseSpec(src)
  for (const t of spec.tests) {
    const add = (rule: string, message: string, line = t.line) => out.push({ rule, message, test: t.title, line })
    const a = assertions(src, t.start, t.end)
    const body = src.slice(t.bodyStart, t.bodyEnd)
    if (!a.length && !/\b(expect|assert|verify|should)\w*\s*\(/i.test(body)) add('no-checks', 'Nothing is checked: this test passes as long as nothing crashes.')
    else if (a.length && a.every((x) => WEAK.has(x.matcher) && !x.not && !NAMED.test(x.target)) && !HELPER.test(body)) add('weak-checks', 'Only checks that something is there, not that it is right. Check a value the person cares about.')
    for (const x of a) if (!x.awaited && WEB.test(x.matcher)) add('missing-await', `${x.matcher} is not awaited, so a failure can be missed.`, x.line)
    for (const m of t.modifiers) if (m === 'only') add('only', 'test.only hides every other test.'); else if (['skip', 'fixme'].includes(m)) add('skipped', `Marked ${m}: it never runs.`)
  }
  const inTest = (pos: number) => spec.tests.find((t) => pos >= t.start && pos < t.end)
  each(ast(src).program, (n) => {
    if (n.type !== 'CallExpression' || n.callee.type !== 'MemberExpression') return
    const m = n.callee.property.name, line = n.loc.start.line, test = inTest(n.start)?.title
    if (m === 'waitForTimeout') out.push({ rule: 'fixed-wait', message: 'A fixed wait is either too short or too slow. Wait for what should appear.', line, test })
    if (n.arguments.some((x: Node) => x.type === 'ObjectExpression' && x.properties.some((p: Node) => p.key?.name === 'force' && p.value?.value === true))) out.push({ rule: 'forced', message: 'force: true clicks things a person could not.', line, test })
    if (m === 'locator' && /^['"`](\/\/|xpath=|.*:nth-child|.*>.*>.*>)/.test(src.slice(n.arguments[0]?.start, n.arguments[0]?.end))) out.push({ rule: 'brittle-locator', message: 'This locator follows page structure. Prefer a role, label or test id.', line, test })
    if (m === 'catch' && n.arguments[0]?.body?.type === 'BlockStatement' && !n.arguments[0].body.body.length) out.push({ rule: 'swallowed-error', message: 'An empty catch hides failures.', line, test })
  })
  return out.sort((a, b) => a.line - b.line)
}

const ACTIONS = new Set(['goto', 'click', 'fill', 'press', 'check', 'uncheck', 'select'])
/** page.getByRole('x', { name: 'y' }).locator('z') and the like: names, calls and literals, nothing that computes. */
function plainExpr(n: Node): boolean {
  if (!n) return true
  switch (n.type) {
    case 'Identifier': case 'StringLiteral': case 'NumericLiteral': case 'BooleanLiteral': case 'RegExpLiteral': return true
    case 'TemplateLiteral': return n.expressions.length === 0
    case 'MemberExpression': return !n.computed && plainExpr(n.object)
    case 'CallExpression': return n.callee.type === 'MemberExpression' && /^(getBy\w+|locator|frameLocator|contentFrame|filter)$/.test(n.callee.property.name) && plainExpr(n.callee.object) && n.arguments.every(plainExpr)
    case 'ObjectExpression': return n.properties.every((p: Node) => p.type === 'ObjectProperty' && !p.computed && plainExpr(p.value))
    case 'ArrayExpression': return n.elements.every((e: Node) => e && plainExpr(e))
    default: return false
  }
}
function sameThing(a: string, b: string) {
  if (a === b) return true
  const at = (l: string) => { const m = l.match(/^page\.getBy(\w+)\(\s*(['"`])(.*?)\2(?:\s*,\s*\{\s*name:\s*(['"`])(.*?)\4\s*\})?\s*\)$/); return m && (m[1] === 'Role' ? (m[5] ? { by: 'Role', role: m[3], name: m[5] } : null) : { by: m[1], role: '', name: m[3] }) }
  const x = at(a), y = at(b)
  if (!x || !y || x.by === 'TestId' || y.by === 'TestId') return false
  if (x.by === y.by) return x.role === y.role && similar(x.name, y.name) >= 0.5
  const roleOk = x.by === 'Text' && y.by === 'Role' && ['button', 'link', 'tab', 'menuitem', 'option'].includes(y.role)
  return roleOk && x.name.toLowerCase() === y.name.toLowerCase()
}
const plain = (code?: string) => { if (!code) return true; try { const st = ast(`(${code})`).program.body[0]; return plainExpr(st.expression) } catch { return false } }
function residue(src: string, spec: Spec) {
  const cut = spec.tests.flatMap((t) => t.steps).filter((s) => s.kind !== 'code' && s.kind !== 'group' && plain(s.target) && plain(s.value))
  // Tokens, so nothing inside a string or pattern is touched. Comments aren't tokens here; a step takes its own ; with it.
  return tokens(src).filter((t) => !cut.some((c) => t.start >= c.start && (t.end <= c.end || (t.text === ';' && src.slice(c.end, t.start).trim() === '')))).map((t) => t.text).join('\u0001')
}
const key = (a: Assertion) => `${a.matcher}|${a.not}|${a.soft}|${a.target}|${a.args}`
const count = (src: string, re: RegExp) => (src.match(re) ?? []).length
/**
 * What `after` makes weaker than `before`. Deliberately strict: any check that disappears or changes is listed, so a
 * person decides. An empty list means no check was removed or altered and nothing was skipped or given more time.
 */
export function guard(before: string, after: string): Finding[] {
  const out: Finding[] = []
  const A = parseSpec(before), B = parseSpec(after)
  const add = (rule: string, message: string, line: number, test?: string) => out.push({ rule, message, line, test })
  const id = (t: { describe: string[]; title: string }) => [...t.describe, t.title].join(' › ')
  for (const t of A.tests) {
    const u = B.tests.find((x) => id(x) === id(t))
    if (!u) { add('test-removed', `The test “${t.title}” is gone or renamed.`, t.line, t.title); continue }
    for (const m of u.modifiers) if (!t.modifiers.includes(m)) add('modifier', `test.${m} was added.`, u.line, t.title)
    diff(assertions(before, t.start, t.end), assertions(after, u.start, u.end), t.title)
    order(t, u)
    actions(t, u)
  }
  const outside = (src: string, s: typeof A) => assertions(src).filter((a) => !s.tests.some((t) => a.start >= t.start && a.start < t.end))
  diff(outside(before, A), outside(after, B))
  const more: [string, RegExp, string][] = [
    ['skip', /\btest\.(skip|fixme|fail|slow)\s*\(|\.skip\(/g, 'A skip, fixme, expected failure or slow marker was added.'],
    ['timeout', /\btimeout\s*:|\bsetTimeout\s*\(|waitForTimeout\s*\(/g, 'A timeout or wait was added.'],
    ['retries', /\bretries\s*:/g, 'Retries were added.'],
    ['force', /force\s*:\s*true/g, 'force: true was added.'],
    ['catch', /\.catch\s*\(|\bcatch\s*[({]/g, 'A catch that can hide failures was added.'],
    ['branch', /\bif\s*\(|\?\s*await|&&\s*await/g, 'A condition was added, so a check may not always run.'],
    ['early-return', /\breturn\s*;?\s*$/gm, 'An early return was added.'],
    ['soft', /expect\.soft/g, 'A hard check became soft.'],
    ['mock', /\.route\s*\(|routeFromHAR/g, 'A network mock was added.'],
    ['first', /\.(first|last)\(\)|\.nth\(/g, 'A locator now picks one of several matches.'],
  ]
  for (const [r, re, msg] of more) if (count(after, re) > count(before, re)) add(r, msg, 1)
  // Allowlist: with plain steps taken out, the rest of the file must be the same, or a person has to read it.
  if (residue(before, A) !== residue(after, B)) add('code-changed', 'Code other than plain steps was added, removed or changed. Read it closely.', 1)
  const nums = (s: string) => [...s.matchAll(/(?:timeout\s*:\s*|setTimeout\(\s*|waitForTimeout\(\s*)([\d_]+)/g)].map((m) => +m[1].replace(/_/g, ''))
  const sum = (x: number[]) => x.reduce((p, c) => p + c, 0)
  if (sum(nums(after)) > sum(nums(before)) && !out.some((f) => f.rule === 'timeout')) add('timeout', 'A timeout was raised.', 1)
  return out

  /** Every old action must still be there, in order. A changed target passes only if it is plainly the same thing renamed. */
  function actions(t: TestInfo, u: TestInfo) {
    const x = t.steps.filter((s) => ACTIONS.has(s.kind)), y = u.steps.filter((s) => ACTIONS.has(s.kind))
    let j = 0
    for (const s of x) {
      const at = y.findIndex((n, i) => i >= j && n.kind === s.kind && n.value === s.value && sameThing(s.target ?? '', n.target ?? ''))
      if (at < 0) { add('action-removed', `This action was removed, moved or aimed at something else: ${s.label}`, u.line, t.title); continue }
      j = at + 1
    }
  }
  function order(t: TestInfo, u: TestInfo) {
    const act = (s: Step) => ACTIONS.has(s.kind) || s.kind === 'code' || s.kind === 'group'
    const seq = (x: TestInfo) => { let n = 0; const m = new Map<string, number[]>(); for (const s of x.steps) if (s.kind === 'expect') { const k = `${s.target}|${s.not}|${s.matcher}|${s.value}`; m.set(k, [...(m.get(k) ?? []), n]) } else if (act(s)) n++; return m }
    const b = seq(u); for (const [k, at] of seq(t)) at.forEach((n, i) => { const m = b.get(k)?.[i]; if (m !== undefined && m < n) add('check-earlier', 'A check now runs earlier, before something it used to follow.', u.line, t.title) })
    const inputs = (x: TestInfo) => x.steps.filter((s) => ['goto', 'fill', 'press', 'select'].includes(s.kind)).map((s) => `${s.kind} ${s.value}`)
    const left = inputs(u); for (const v of inputs(t)) { const i = left.indexOf(v); if (i < 0) add('input-changed', `An input was changed or removed: ${v}`, u.line, t.title); else left.splice(i, 1) }
  }
  function diff(x: Assertion[], y: Assertion[], test?: string) {
    const left = y.map(key)
    const gone = x.filter((a) => { const i = left.indexOf(key(a)); if (i >= 0) { left.splice(i, 1); return false } return true })
    const fresh = [...y]; for (const a of x) { const i = fresh.findIndex((b) => key(b) === key(a)); if (i >= 0) fresh.splice(i, 1) }
    for (const a of gone) {
      const i = fresh.findIndex((b) => b.matcher === a.matcher && b.not === a.not && b.args === a.args)
      if (i >= 0) { const b = fresh.splice(i, 1)[0]; add('check-target', `The check now looks at ${b.target} instead of ${a.target}.`, b.line, test); continue }
      add('check-changed', `This check was removed or changed: expect(${a.target})${a.not ? '.not' : ''}.${a.matcher}(${a.args})`, a.line, test)
    }
  }
}
