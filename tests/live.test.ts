// Real Playwright runs against the demo shop. Slow: one browser at a time.
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { faultCheck } from '../src/core/faults'
import { flakeLab } from '../src/core/flake'
import { openProject, readSpec } from '../src/core/project'
import { propose, tryOut } from '../src/core/proposals'
import { explain, run } from '../src/core/run'
import { suggest } from '../src/core/suggest'
import { describe, expect, it } from './kit'
process.env.PORT = '4197'
const d = mkdtempSync(join(tmpdir(), 'breakwright live ')); cpSync('examples/shop', d, { recursive: true, filter: (f) => !/\.breakwright|test-results/.test(f) }); symlinkSync(resolve('node_modules'), join(d, 'node_modules'))
const p = openProject(d), line = (f: string, t: string) => readSpec(p, f).tests!.find((x) => x.title === t)!.line
const S = 'tests/shop.spec.ts', W = 'tests/weak.spec.ts'
describe('live', () => {
  it('runs one test by line (folder name has spaces)', async () => { const r = await run(p, { targets: [{ file: S, line: line(S, 'add a mug') }] }); expect(r.problem).toBe(undefined); expect(r.results.length).toBe(1); expect(r.ok).toBe(true); expect(r.results[0].file).toBe(S) })
  it('a strong test catches faults', async () => { const r = await faultCheck(p, { file: S, line: line(S, 'add a mug') }, { max: 3 }); console.log(JSON.stringify(r.outcomes)); expect(r.baseline).toBe('passed'); expect(r.outcomes.map((o) => o.verdict)).toEqual(['caught', 'caught', 'caught']) })
  it('a weak test misses them', async () => { const r = await faultCheck(p, { file: W, line: line(W, 'add a mug (weak)') }, { max: 3 }); console.log(JSON.stringify(r.outcomes)); expect(r.outcomes.map((o) => o.verdict)).toEqual(['missed', 'missed', 'missed']) })
  it('a blocked step is not counted as a check', async () => { const r = await faultCheck(p, { file: W, line: line(W, 'add a mug (weak)') }); expect(r.outcomes.find((o) => o.kind === 'empty' && o.key === 'GET /api/products')!.verdict).toBe('stopped'); expect(r.caught).toBe(0) })
  it('reads a failure, finds the renamed button, and the repair passes as a trial', async () => {
    const f = join(d, 'tests/broken.spec.ts'); writeFileSync(f, `import { test, expect } from '@playwright/test'\ntest('renamed', async ({ page }) => {\n  await page.goto('/')\n  await page.getByRole('button', { name: 'Place an order' }).click()\n  await expect(page.getByRole('status')).toHaveText('Your cart is empty')\n})\n`)
    const t = (await run(p, { targets: [{ file: 'tests/broken.spec.ts' }] })).results[0]
    const x = explain(t); expect(x.kind).toBe('not-found'); expect(x.page).toContain('Place order')
    const sug = suggest(`page.getByRole('button', { name: 'Place an order' })`, x.page)[0]; expect(sug.locator).toBe(`page.getByRole('button', { name: 'Place order' })`)
    const pr = propose(p, { file: 'tests/broken.spec.ts', after: readFileSync(f, 'utf8').replace(`page.getByRole('button', { name: 'Place an order' })`, sug.locator), title: 't', why: 'w', by: 'x' })
    expect((await tryOut(p, pr.id)).trial!.ok).toBe(true); expect(readdirSync(join(d, 'tests')).some((n) => n.startsWith('breakwright-tmp'))).toBe(false); expect(readFileSync(f, 'utf8')).toContain('Place an order')
  })
  it('finds a flake', async () => { writeFileSync(join(d, 'tests/flaky.spec.ts'), `import { test, expect } from '@playwright/test'\ntest('odd', async ({}, info) => { expect(info.repeatEachIndex % 2).toBe(0) })\n`); const r = await flakeLab(p, { file: 'tests/flaky.spec.ts' }, { repeat: 4 }); expect(r.verdict).toContain('Flaky'); expect(r.runs[0].failed).toBe(2) })
  it('reports a project that cannot run', async () => { const r = await run(p, { targets: [{ file: 'tests/none.spec.ts' }] }); expect(r.ok).toBe(false); expect(!!r.problem).toBe(true) })
  it('serves MCP over stdio', async () => {
    const c = new Client({ name: 'probe', version: '1' }); await c.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('dist/cli.mjs'), 'mcp', d, '--allow', 'run,propose'], env: { ...process.env, PORT: '4197' } as Record<string, string> }))
    const names = (await c.listTools()).tools.map((t) => t.name); expect(names).toContain('run_test'); expect(names).not.toContain('explore_page'); expect(names).not.toContain('try_proposal')
    const r: any = await c.callTool({ name: 'run_test', arguments: { file: S, test: 'sign in greets the person' } }); expect(r.content[0].text).toContain('passed'); await c.close()
  })
  it('leaves no files outside .breakwright', () => expect(existsSync(join(d, 'test-results'))).toBe(false))
})
