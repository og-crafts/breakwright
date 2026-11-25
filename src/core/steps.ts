/** Reads Playwright specs into tests and steps, and edits one step without touching any other character. */
import { parse, parseExpression } from '@babel/parser'

export type StepKind = 'goto' | 'click' | 'fill' | 'press' | 'check' | 'uncheck' | 'select' | 'expect' | 'group' | 'code'
export interface Step {
  kind: StepKind; start: number; end: number; line: number; code: string
  /** Locator (or "page") as code, e.g. page.getByRole('button', { name: 'Save' }) */
  target?: string
  /** First argument as code */
  value?: string
  matcher?: string; not?: boolean; soft?: boolean
  label: string
}
export interface TestInfo { title: string; line: number; start: number; end: number; bodyStart: number; bodyEnd: number; modifiers: string[]; steps: Step[]; describe: string[] }
export interface Spec { tests: TestInfo[]; hash: string }

type Node = any
export const ast = (src: string): Node => parse(src, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx', 'decorators'], errorRecovery: false, allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true })
export const tokens = (src: string): { start: number; end: number; text: string }[] => ((parse(src, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx', 'decorators'], allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, tokens: true }) as Node).tokens as Node[]).filter((t) => t.end > t.start && !/^Comment/.test(t.type)).map((t) => ({ start: t.start, end: t.end, text: src.slice(t.start, t.end) }))
export function isExpression(code: string) { try { const e = parseExpression(code, { plugins: ['typescript'] }); return e.type !== 'SequenceExpression' } catch { return false } }

export function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0).toString(16) + s.length.toString(16) }

/** Dotted callee name: test.describe.only → "test.describe.only" */
export function calleeName(n: Node): string {
  if (!n) return ''
  if (n.type === 'Identifier') return n.name
  if (n.type === 'MemberExpression' && !n.computed) return `${calleeName(n.object)}.${n.property.name}`
  return ''
}
const str = (n: Node): string | null => n?.type === 'StringLiteral' ? n.value : n?.type === 'TemplateLiteral' ? n.quasis.map((q: Node) => q.value.cooked).join('…') : null
const isFn = (n: Node) => n && (n.type === 'ArrowFunctionExpression' || n.type === 'FunctionExpression')

const METHOD: Record<string, StepKind> = { goto: 'goto', click: 'click', fill: 'fill', press: 'press', check: 'check', uncheck: 'uncheck', selectOption: 'select' }
export const KIND_METHOD: Partial<Record<StepKind, string>> = Object.fromEntries(Object.entries(METHOD).map(([m, k]) => [k, m]))

function toStep(src: string, st: Node): Step {
  const base = { start: st.start, end: st.end, line: st.loc.start.line, code: src.slice(st.start, st.end) }
  const code: Step = { ...base, kind: 'code', label: base.code.split('\n')[0].slice(0, 90) }
  if (st.type !== 'ExpressionStatement') return code
  let e = st.expression
  if (e.type !== 'AwaitExpression') return code
  e = e.argument
  if (e.type !== 'CallExpression') return code
  if (calleeName(e.callee) === 'test.step') return { ...base, kind: 'group', label: str(e.arguments[0]) ?? 'step' }
  if (e.callee.type !== 'MemberExpression' || e.callee.computed) return code
  const method = e.callee.property.name as string
  let obj = e.callee.object
  const arg0 = e.arguments[0] ? src.slice(e.arguments[0].start, e.arguments[0].end) : undefined
  // expect(x).not.toY(z)
  let not = false
  if (obj.type === 'MemberExpression' && obj.property.name === 'not') { not = true; obj = obj.object }
  if (obj.type === 'CallExpression' && ['expect', 'expect.soft'].includes(calleeName(obj.callee)) && obj.arguments.length === 1) {
    if (e.arguments.length > 1) return { ...code, matcher: method, label: code.label }
    const target = src.slice(obj.arguments[0].start, obj.arguments[0].end)
    return { ...base, kind: 'expect', target, matcher: method, not, soft: calleeName(obj.callee) === 'expect.soft', value: arg0, label: `Check ${describe(target)} ${not ? 'not ' : ''}${words(method)}${arg0 ? ' ' + arg0 : ''}` }
  }
  const kind = METHOD[method]
  if (!kind || e.arguments.length > 1 || (!arg0 && !['click', 'check', 'uncheck'].includes(kind)) || (arg0 && ['click', 'check', 'uncheck'].includes(kind))) return code
  const target = src.slice(obj.start, obj.end)
  return { ...base, kind, target, value: arg0, label: kind === 'goto' ? `Open ${arg0}` : `${cap(kind)} ${describe(target)}${arg0 ? ` ${kind === 'fill' ? 'with' : '·'} ${arg0}` : ''}` }
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
const words = (m: string) => m.replace('URL', 'Url').replace(/^to/, '').replace(/([A-Z])/g, ' $1').trim().toLowerCase()
export function describe(t: string) {
  const m = t.match(/getByRole\(\s*(['"`])(.+?)\1(?:\s*,\s*\{[^}]*name:\s*(['"`/])(.+?)\3)?/)
  if (m) return m[4] ? `${m[2]} “${m[4]}”` : m[2]
  const g = t.match(/getBy(Label|Text|TestId|Placeholder|Title|AltText)\(\s*(['"`/])(.+?)\2/)
  if (g) return `${g[1].toLowerCase()} “${g[3]}”`
  const l = t.match(/locator\(\s*(['"`])(.+?)\1/)
  return l ? l[2] : t === 'page' ? 'page' : t.slice(0, 50)
}

export function parseSpec(src: string): Spec {
  const tests: TestInfo[] = []
  const walk = (n: Node, desc: string[]) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) { n.forEach((x) => walk(x, desc)); return }
    if (n.type === 'CallExpression') {
      const name = calleeName(n.callee)
      const fn = n.arguments.findLast?.(isFn) ?? n.arguments.filter(isFn).at(-1)
      const title = str(n.arguments[0])
      if (/^test\.describe(\.\w+)*$/.test(name) && fn) { walk(fn.body, title === null ? desc : [...desc, title]); return }
      if (/^(test|it)(\.(only|skip|fixme|fail|slow))*$/.test(name) && title !== null && fn && fn.body.type === 'BlockStatement') {
        tests.push({ title, line: n.loc.start.line, start: n.start, end: n.end, bodyStart: fn.body.start + 1, bodyEnd: fn.body.end - 1, modifiers: name.split('.').slice(1), describe: desc, steps: fn.body.body.map((s: Node) => toStep(src, s)) })
        return
      }
    }
    for (const k in n) if (k !== 'loc' && k !== 'leadingComments' && k !== 'trailingComments') { const v = n[k]; if (v && typeof v === 'object') walk(v, desc) }
  }
  walk(ast(src).program, [])
  return { tests, hash: hash(src) }
}

export interface StepInput { kind: StepKind; target?: string; value?: string; matcher?: string; not?: boolean; soft?: boolean; code?: string }
export function stepCode(s: StepInput): string {
  if (s.kind === 'code' || s.kind === 'group') { if (!s.code?.trim()) throw new Error('The code is empty.'); ast(`async()=>{${s.code}\n}`); return s.code.trim() }
  const t = (s.target || (s.kind === 'goto' ? 'page' : '')).trim()
  if (!isExpression(t)) throw new Error(`Not a valid locator: ${t || '(empty)'}`)
  if (s.value !== undefined && s.value !== '' && !isExpression(s.value)) throw new Error(`Not a valid value: ${s.value}`)
  if (s.kind === 'expect') {
    if (!/^to[A-Za-z]+$/.test(s.matcher ?? '')) throw new Error('Pick a check.')
    return `await expect${s.soft ? '.soft' : ''}(${t})${s.not ? '.not' : ''}.${s.matcher}(${s.value ?? ''})`
  }
  if (['goto', 'fill', 'press', 'select'].includes(s.kind) && !s.value) throw new Error('This step needs a value.')
  return `await ${t}.${KIND_METHOD[s.kind]}(${s.value ?? ''})`
}

const find = (src: string, title: string, line?: number) => {
  const all = parseSpec(src).tests.filter((t) => t.title === title)
  const t = all.find((x) => x.line === line) ?? (all.length === 1 ? all[0] : undefined)
  if (!t) throw new Error(`Couldn’t find the test “${title}”.`)
  return t
}
/** Replace step `index` (null input deletes). Keeps a trailing semicolon if there was one. */
export function editStep(src: string, title: string, line: number | undefined, index: number, input: StepInput | null): string {
  const s = find(src, title, line).steps[index]
  if (!s) throw new Error('No such step.')
  if (input) {
    const code = glue(stepCode(input), src.slice(0, s.start))
    const n = stepCount(code)
    return check(src.slice(0, s.start) + code + (s.code.endsWith(';') && !code.endsWith(';') ? ';' : '') + src.slice(s.end), src, title, line, index, n, 1)
  }
  let from = s.start, to = s.end
  while (from > 0 && /[ \t]/.test(src[from - 1])) from--
  if (from > 0 && src[from - 1] === '\n' && /^[ \t]*(\r?\n)/.test(src.slice(to))) { to += src.slice(to).match(/^[ \t]*\r?\n/)![0].length } else from = s.start
  return check(src.slice(0, from) + src.slice(to), src, title, line, index, 0, 1)
}
export function insertStep(src: string, title: string, line: number | undefined, index: number, input: StepInput): string {
  const t = find(src, title, line)
  const semi = t.steps.some((s) => s.code.endsWith(';')) ? ';' : ''
  let code = stepCode(input); const n = stepCount(code); code = glue(code, src.slice(0, index > 0 ? t.steps[index - 1]?.end : t.bodyStart)); if (semi && !code.endsWith(';')) code += ';'
  const nl = src.includes('\r\n') ? '\r\n' : '\n'
  const lineIndent = (pos: number) => src.slice(src.lastIndexOf('\n', pos - 1) + 1, pos).match(/^[ \t]*/)![0]
  if (index > 0 && t.steps[index - 1]) { const p = t.steps[index - 1]; return check(src.slice(0, p.end) + nl + lineIndent(p.start) + code + src.slice(p.end), src, title, line, index, n, 0) }
  if (t.steps[0]) { const f = t.steps[0]; return check(src.slice(0, f.start) + code + nl + lineIndent(f.start) + src.slice(f.start), src, title, line, 0, n, 0) }
  const ind = lineIndent(t.start)
  return check(src.slice(0, t.bodyStart) + nl + ind + '  ' + code + nl + ind + src.slice(t.bodyEnd), src, title, line, 0, n, 0)
}
export function moveStep(src: string, title: string, line: number | undefined, index: number, by: -1 | 1): string {
  const { steps } = find(src, title, line)
  const a = steps[Math.min(index, index + by)], b = steps[Math.max(index, index + by)]
  if (!a || !b) throw new Error('Can’t move further.')
  return check(src.slice(0, a.start) + b.code + src.slice(a.end, b.start) + a.code + src.slice(b.end), src, title, line, Math.min(index, index + by), 2, 2)
}
const stepCount = (code: string) => ast(`async()=>{${code}\n}`).program.body[0].expression.body.body.length as number
/** Without semicolons, a line starting like this would join the one before it. */
const glue = (code: string, before: string) => (/^[([`+\-/]/.test(code) && !/[;{]\s*$/.test(before) ? ';' : '') + code
/** The edit must leave every other step exactly as it was: `put` steps now stand where `took` stood at `at`. */
function check(out: string, src: string, title: string, line: number | undefined, at: number, put: number, took: number) {
  let next: string[], old: string[]
  const bare = (s: Step) => s.code.replace(/\s*;$/, '')
  try { next = find(out, title, line).steps.filter((s) => s.code !== ';').map(bare) } catch (e) { throw new Error(`That would break the file: ${(e as Error).message}`) }
  old = find(src, title, line).steps.filter((s) => s.code !== ';').map(bare)
  const ok = next.length === old.length - took + put && old.slice(0, at).every((c, i) => c === next[i]) && old.slice(at + took).every((c, i) => c === next[at + put + i])
  if (!ok) throw new Error('That would change a neighbouring step. Put comments on their own line, or edit the source.')
  return out
}
