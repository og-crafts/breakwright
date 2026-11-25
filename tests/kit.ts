import { strict as assert } from 'node:assert'
import { describe, it as base } from 'node:test'
export { describe, assert }
const each = (rows: any[][]) => (name: string, f: (...a: any[]) => any) => { for (const r of rows) base(name.replace('%s', r[0]), () => f(...r)) }
export const it = Object.assign((n: string, f: () => any, o: object = {}) => base(n, o, f), { each })
export const expect = (a: any) => {
  const make = (no: boolean) => {
    const ok = (c: boolean, m: string) => assert.ok(no ? !c : c, `${no ? 'not: ' : ''}${m}\n got: ${typeof a === 'string' ? a.slice(0, 900) : JSON.stringify(a)?.slice(0, 900)}`)
    const same = (b: any) => { try { assert.deepEqual(a, b); return true } catch { return false } }
    return { toBe: (b: any) => no ? ok(a === b, `be ${b}`) : assert.equal(a, b), toEqual: (b: any) => no ? ok(same(b), 'equal') : assert.deepEqual(a, b), toContain: (b: any) => ok(a.includes(b), `contain ${b}`), toMatch: (r: RegExp) => ok(r.test(a), `match ${r}`), toHaveLength: (n: number) => ok(a.length === n, `length ${n}`), toThrow: (r?: RegExp) => { let e: any; try { a() } catch (x) { e = x } ok(!!e && (!r || r.test(e.message)), `throw (${e?.message})`) } }
  }
  return { ...make(false), not: make(true) }
}
