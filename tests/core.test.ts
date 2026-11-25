import { describe, expect, it } from './kit'
import { editStep, insertStep, moveStep, parseSpec } from '../src/core/steps'
import { audit, guard } from '../src/core/audit'
import { cutSource } from '../src/core/run'
import { Redactor } from '../src/core/redact'
import { judge, planFaults } from '../src/core/faults'
import { inside, openProject, specPath } from '../src/core/project'

const SRC = `import { test, expect } from '@playwright/test';
// keep   this  comment
test.describe('cart', () => {
  test('adds', async ({ page }) => {
    await page.goto('/');   // odd   spacing
    await page.getByRole('button', { name: 'Add' }).click();
    const n = 1 + 1 // own code
    for (const x of [1,2]) { await page.keyboard.press('Tab') }
    await expect(page.getByTestId('total')).toHaveText('$12');
  });
})
`
describe('steps', () => {
  it('reads known steps and keeps the rest as code', () => {
    const t = parseSpec(SRC).tests[0]
    expect(t.describe).toEqual(['cart'])
    expect(t.steps.map((s) => s.kind)).toEqual(['goto', 'click', 'code', 'code', 'expect'])
    expect(t.steps[1].label).toBe('Click button “Add”')
  })
  it('changes only the edited step', () => {
    const out = editStep(SRC, 'adds', undefined, 1, { kind: 'click', target: `page.getByText('More')` })
    expect(out).toBe(SRC.replace(`page.getByRole('button', { name: 'Add' }).click()`, `page.getByText('More').click()`))
  })
  it('inserts, moves and deletes', () => {
    const a = insertStep(SRC, 'adds', undefined, 5, { kind: 'expect', target: 'page', matcher: 'toHaveURL', value: `'/'` })
    expect(a).toContain(`toHaveText('$12');\n    await expect(page).toHaveURL('/');\n`)
    expect(editStep(a, 'adds', undefined, 5, null)).toBe(SRC)
    expect(moveStep(moveStep(SRC, 'adds', undefined, 0, 1), 'adds', undefined, 1, -1)).toBe(SRC)
  })
  it('handles empty bodies and CRLF', () => {
    expect(parseSpec(insertStep(`test('x', async ({ page }) => {})`, 'x', undefined, 0, { kind: 'goto', value: `'/'` })).tests[0].steps).toHaveLength(1)
    expect(insertStep(SRC.replace(/\n/g, '\r\n'), 'adds', undefined, 1, { kind: 'code', code: 'await page.reload()' })).not.toMatch(/[^\r]\n/)
  })
  it('refuses code smuggled through a field', () => {
    expect(() => editStep(SRC, 'adds', undefined, 1, { kind: 'click', target: 'page); evil(' })).toThrow()
    expect(() => editStep(SRC, 'adds', undefined, 0, { kind: 'goto', value: `'/'), evil(` })).toThrow()
    expect(() => editStep(SRC, 'adds', undefined, 0, { kind: 'goto', value: `'/'; x` })).toThrow()
  })
  it('review: edits never swallow or join a neighbour', () => {
    const one = `test('x', async ({ page }) => { await page.goto('/'); await page.reload() })`
    expect(() => editStep(one, 'x', undefined, 0, { kind: 'code', code: `await page.goto('/') // note` })).toThrow()
    const two = `test('x', async ({ page }) => {\n  await page.goto('/')\n  await page.reload()\n})`
    const out = insertStep(two, 'x', undefined, 1, { kind: 'code', code: `(async () => { await page.reload() })()` })
    expect(parseSpec(out).tests[0].steps.filter((s) => s.code !== ';').length).toBe(3)
    expect(parseSpec(out).tests[0].steps[0].kind).toBe('goto')
  })
  it('keeps steps it cannot show fully (options) as code', () => {
    expect(parseSpec(`test('x', async ({page}) => { await page.click('a', { force: true }); await expect(page).toHaveText('a', { timeout: 1 }) })`).tests[0].steps.map((s) => s.kind)).toEqual(['code', 'code'])
  })
})
describe('audit', () => {
  const rules = (body: string) => audit(`test('x', async ({ page }) => { ${body} })`).map((f) => f.rule)
  it('flags weak tests', () => {
    expect(rules(`await page.goto('/')`)).toContain('no-checks')
    expect(rules(`await expect(page).toHaveURL('/')`)).toContain('weak-checks')
    expect(rules(`expect(page.locator('a')).toHaveText('b')`)).toContain('missing-await')
    expect(rules(`await page.waitForTimeout(500); await expect(page.locator('a')).toHaveText('b')`)).toEqual(['fixed-wait'])
  })
  it('is quiet on a good test', () => expect(rules(`await expect(page.getByRole('status')).toHaveText('Saved')`)).toEqual([]))
})
describe('guard', () => {
  const t = (b: string, m = '') => `test${m}('x', async ({ page }) => {\n ${b}\n})`
  const base = `await page.getByText('a').click(); await expect(page.locator('#t')).toHaveText('5')`
  const rules = (b: string, m = '') => guard(t(base), t(b, m)).map((f) => f.rule)
  it('allows a new locator on an action', () => expect(rules(base.replace(`getByText('a')`, `getByRole('button', { name: 'A' })`))).toEqual([]))
  it('allows added checks', () => expect(rules(base + `; await expect(page).toHaveURL('/')`)).toEqual([]))
  it.each([
    ['removed check', `await page.getByText('a').click()`, 'check-changed'],
    ['weaker matcher', base.replace(`toHaveText('5')`, 'toBeVisible()'), 'check-changed'],
    ['changed value', base.replace(`'5'`, `'6'`), 'check-changed'],
    ['moved target', base.replace('#t', '#u'), 'check-target'],
    ['negated', base.replace('.toHaveText', '.not.toHaveText'), 'check-changed'],
    ['soft', base.replace('expect(', 'expect.soft('), 'soft'],
    ['longer wait', base + `; await page.waitForTimeout(9000)`, 'timeout'],
    ['conditional', base.replace('await expect', 'if (1) await expect'), 'branch'],
    ['caught', base + `.catch(() => {})`, 'catch'],
    ['removed action', base.replace(`await page.getByText('a').click(); `, ''), 'action-removed'],
    ['mock', `await page.route('**', r => r.abort()); ` + base, 'mock'],
    ['first', base.replace(`getByText('a')`, `getByText('a').first()`), 'first'],
  ])('flags: %s', (_n, b, rule) => expect(rules(b)).toContain(rule))
  it.each([
    ['constant', `const want = '5'; ` + base, 'code-changed'],
    ['computed locator', base.replace(`page.getByText('a')`, `(globalThis.x = 1, page.getByText('a'))`), 'code-changed'],
    ['return', `return; ` + base, 'code-changed'],
    ['earlier check', `await expect(page.locator('#t')).toHaveText('5'); await page.getByText('a').click()`, 'check-earlier'],
    ['test.setTimeout', `test.setTimeout(99999); ` + base, 'code-changed'],
  ])('allowlist flags: %s', (_n, b, rule) => expect(rules(b)).toContain(rule))
  it('allowlist flags code outside tests and changed inputs', () => {
    const f = (top: string, v: string) => `${top}test('x', async ({ page }) => { await page.getByLabel('q').fill('${v}'); await expect(page.locator('#t')).toHaveText('5') })`
    expect(guard(f('const a = 5\n', 'v'), f('const a = 6\n', 'v')).map((x) => x.rule)).toContain('code-changed')
    expect(guard(f('', 'v'), f('', '')).map((x) => x.rule)).toContain('input-changed')
    expect(guard(f('', 'v'), f('// note\n', 'v'))).toEqual([])
  })
  it.each([
    ['uncheck removed', `await page.getByLabel('Opt').uncheck(); ` + base, base],
    ['click aimed elsewhere', base, base.replace(`getByText('a')`, `getByRole('heading')`)],
    ['fill aimed elsewhere', `await page.getByLabel('From').fill('x'); ` + base, `await page.getByLabel('Destination').fill('x'); ` + base],
    ['kind changed', `await page.getByLabel('o').check(); ` + base, `await page.getByLabel('o').uncheck(); ` + base],
    ['reordered', `await page.getByLabel('o').fill('x'); ` + base, base.replace('click();', `click(); await page.getByLabel('o').fill('x');`)],
    ['string with ;', `const s = 'a;b'; ` + base, `const s = 'ab'; ` + base],
    ['pattern spaces', `const s = /a  b/; ` + base, `const s = /a b/; ` + base],
  ])('review: %s', (_n, a, b) => expect(guard(t(a), t(b)).length > 0).toBe(true))
  it('review: soft swapped between tests', () => { const two = (a: string, b: string) => `test('x', async () => { await ${a}(l).toHaveText('1') })\ntest('y', async () => { await ${b}(l).toHaveText('1') })`; expect(guard(two('expect.soft', 'expect'), two('expect', 'expect.soft')).length > 0).toBe(true) })
  it('a plain rename still passes clean', () => expect(guard(t(`await page.getByRole('button', { name: 'Place an order' }).click(); ` + base), t(`await page.getByRole('button', { name: 'Place order' }).click(); ` + base))).toEqual([]))
  it('flags skip', () => expect(rules(base, '.skip')).toContain('modifier'))
})
describe('faults', () => {
  it('plans actions and writes before page loads', () => {
    const { faults, skipped } = planFaults([{ t: 'api', key: 'GET /a', status: 200, json: true }, { t: 'click', key: 'button "x"' }, { t: 'api', key: 'POST /b', status: 200, json: true }], 3)
    expect(faults.map((f) => f.kind)).toEqual(['dead-action', 'fail', 'change']); expect(skipped).toBe(3)
  })
  it('tells a check from a blocked step, and never counts a fault that was not reached', () => {
    const r = (status: string, message = '') => ({ status, attempts: [{ status, ms: 1, attachments: [], errors: message ? [{ message }] : [] }] }) as never
    expect(judge(r('failed', 'Error: expect(locator).toHaveText(expected) failed'), true).verdict).toBe('caught')
    expect(judge(r('failed', 'locator.click: Timeout'), true).verdict).toBe('stopped')
    expect(judge(r('passed'), true).verdict).toBe('missed')
    expect(judge(r('failed', 'x'), false).verdict).toBe('not-reached')
  })
})
describe('errors', () => { it('source lines are not part of the message', () => expect(cutSource('TimeoutError: locator.click: Timeout\nCall log:\n  - waiting\n\n\n   7 |\n>  9 | x\n  10 | await expect(page)')).not.toContain('expect')) })
describe('safety', () => {
  it('keeps paths inside the project', () => {
    const p = openProject('examples/shop')
    expect(() => inside(p, '../x')).toThrow(); expect(() => inside(p, '/etc/passwd')).toThrow(); expect(() => specPath(p, 'playwright.config.ts')).toThrow(); expect(() => specPath(p, 'node_modules/a.spec.ts')).toThrow()
  })
  it.each([`page.fill('#password','hunter2x')`, `page.getByRole('textbox',{name:'Password'}).fill('hunter2x')`, `page.getByLabel('Password').pressSequentially('hunter2x')`, `{ 'Authorization': 'Bearer hunter2x' }`, 'Bearer hunter2xabc', `password: "ab'hunter2x"`, 'PASSWORD=hunter2x', 'password: hunter2x', 'https://me:hunter2x@host/x', 'Cookie: session=hunter2x', '/a?access_token=hunter2x', '/a?x=1&client_secret=hunter2x', 'x-api-key: hunter2x', 'const pwd = "hunter2x"', 'github_pat_hunter2xhunter2x', '-----BEGIN RSA PRIVATE KEY-----\nhunter2x'].map((x) => [x]))('review: hides %s', (x) => expect(new Redactor().text(x)).not.toContain('hunter2x'))
  it('hides known values in other forms', () => { const r = new Redactor(['p@ss w"rd']); for (const x of [encodeURIComponent('p@ss w"rd'), Buffer.from('p@ss w"rd').toString('base64'), JSON.stringify('p@ss w"rd')]) expect(r.text(x)).toContain('<hidden>') })
  it('leaves ordinary test code readable', () => { const c = `await page.getByLabel('Password').click()\nawait expect(page.getByText('Token created')).toBeVisible()\nconst token = await getToken()`; expect(new Redactor().text(c)).toBe(c) })
  it('hides secrets', () => {
    const x = new Redactor(['hunter2!']).text(`a hunter2! Authorization: Bearer abc123 password: 'letmein' ?token=zzz getByLabel('Password').fill('s3cret')`)
    for (const s of ['hunter2!', 'abc123', 'letmein', 'zzz', 's3cret']) expect(x).not.toContain(s)
  })
})
