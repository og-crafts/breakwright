// Drives the real app in a headless browser, on a copy of the demo shop, and takes pictures.
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert'
const d = join(mkdtempSync(join(tmpdir(), 'walk-')), 'shop'); cpSync('examples/shop', d, { recursive: true, filter: (f) => !/\.breakwright|test-results/.test(f) }); symlinkSync(resolve('node_modules'), join(d, 'node_modules'))
const app = spawn(process.execPath, ['dist/cli.mjs', 'open', '--print-url'], { env: { ...process.env, PORT: '4177', BREAKWRIGHT_HOME: mkdtempSync(join(tmpdir(), 'walk-h-')) }, stdio: ['pipe', 'pipe', 'inherit'] })
const url = await new Promise((ok) => app.stdout.once('data', (x) => ok(JSON.parse(x).url)))
const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage(); page.setDefaultTimeout(20000)
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => m.type() === 'error' && errs.push(m.text()))
const shot = (n) => page.screenshot({ path: `docs/shots/${n}.png` })
const btn = (n, o = {}) => page.getByRole('button', { name: n, ...o })
try {
  await page.goto(url); await page.getByLabel('Project folder').waitFor(); assert(!page.url().includes('#')); await shot('1-home')
  await page.getByLabel('Project folder').fill(d); await btn('Open folder').click()
  await btn('add a mug (weak)').click(); await page.getByRole('heading', { name: 'add a mug (weak)' }).waitFor(); await shot('2-weak-untrusted')
  assert(await btn('Check with faults').isDisabled()); await btn('Trust and allow running').click()
  await btn('Run', { exact: true }).click(); await page.getByText(/Passed in/).waitFor({ timeout: 90000 })
  await btn('Check with faults').click(); await page.getByRole('heading', { name: /faults caught by a check/ }).waitFor({ timeout: 180000 }); await shot('3-weak-proof')
  await page.getByRole('tab', { name: 'Steps' }).click(); await btn('Add after step 2').click(); await page.getByLabel('Element').fill(`page.getByRole('status')`); await page.getByLabel('Value').fill(`'Mug added'`); await btn('Add step').click()
  await btn(/Check status/).waitFor(); assert(readFileSync(join(d, 'tests/weak.spec.ts'), 'utf8').includes(`await expect(page.getByRole('status')).toHaveText('Mug added')`))
  await btn('Check with faults').click(); await page.getByText(/of \d+ tried|Running it once/).first().waitFor(); await page.getByRole('heading', { name: /[1-9]\d* of \d+ faults caught/ }).waitFor({ timeout: 180000 }); await shot('4-after-adding-a-check')
  // a failure
  await page.getByRole('tab', { name: 'Steps' }).click(); await btn(/Check status/).click(); await page.getByLabel('Value').fill(`'Lamp added'`); await btn('Save step').click()
  await btn('Run', { exact: true }).click(); await page.getByText('A check found a different value.').waitFor({ timeout: 90000 }); await shot('5-failure')
  await btn('See the whole run').click(); await page.getByRole('heading', { name: 'Needs a look' }).waitFor(); await shot('6-run')
  for (const [n, h] of [['Proposals', 'Proposals'], ['Sign-in', 'Sign-in'], ['AI access', 'AI access']]) { await btn(n).click(); await page.getByRole('heading', { name: h, exact: true }).waitFor() }
  await shot('7-ai-access'); await btn('Assistant').click(); await page.getByRole('complementary', { name: 'Assistant' }).waitFor()
  await page.setViewportSize({ width: 390, height: 780 }); await btn('Close').click(); await btn('Tests', { exact: true }).click(); await page.waitForTimeout(400); await shot('8-phone'); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sideways scroll')
  await page.setViewportSize({ width: 1280, height: 800 }); await page.emulateMedia({ colorScheme: 'dark' }); await btn('add a mug (weak)').click(); await page.getByRole('tab', { name: 'Proof' }).click(); await page.getByRole('table').waitFor(); await shot('9-dark')
  console.log('walk ok', errs.length ? errs : 'no console errors')
} catch (e) { await shot('fail'); console.log('FAILED', e.message, errs); process.exitCode = 1 } finally { await b.close(); app.stdin.end() }
