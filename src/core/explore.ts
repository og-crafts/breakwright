/** Opens one page of an allowed site, headless, and returns what a screen reader would see. */
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { Project } from './project'
export const origin = (u: string) => { const x = new URL(u); if (!/^https?:$/.test(x.protocol)) throw new Error('Only http and https pages.'); return x.origin }
export async function explore(p: Project, url: string, sites: string[], o: { storage?: string; signal?: AbortSignal } = {}) {
  const allowed = new Set(sites.map(origin))
  if (!allowed.has(origin(url))) throw new Error(`${origin(url)} isn’t in the allowed sites.`)
  const { chromium } = createRequire(join(p.root, 'package.json'))('@playwright/test')
  const b = await chromium.launch({ args: process.env.BREAKWRIGHT_BROWSER_ARGS?.split(' ') })
  const stop = () => void b.close().catch(() => {})
  o.signal?.addEventListener('abort', stop, { once: true })
  try {
    const ctx = await b.newContext({ serviceWorkers: 'block', acceptDownloads: false, ...(o.storage ? { storageState: o.storage } : {}) })
    // A page may not take the browser to a site that isn't allowed (redirects are checked below, before anything is read).
    await ctx.route('**/*', (r: any) => r.request().isNavigationRequest() && !allowed.has(safeOrigin(r.request().url())) ? r.abort() : r.continue())
    const page = await ctx.newPage()
    await page.goto(url, { timeout: 20_000, waitUntil: 'load' })
    await page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {})
    if (!allowed.has(origin(page.url()))) throw new Error('The page redirected to a site that isn’t allowed.')
    return { url: page.url() as string, title: await page.title() as string, snapshot: (await page.locator('body').ariaSnapshot()) as string }
  } finally { o.signal?.removeEventListener('abort', stop); await b.close().catch(() => {}) }
}
const safeOrigin = (u: string) => { try { return new URL(u).origin } catch { return '' } }
