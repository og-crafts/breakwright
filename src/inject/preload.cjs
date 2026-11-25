/* Loaded into Playwright's processes with NODE_OPTIONS=--require. Records what a test touches, or injects ONE fault.
   Never edits test files. Plan comes from BREAKWRIGHT_PLAN (JSON); observations are appended to BREAKWRIGHT_LOG (JSON lines). */
'use strict'
const Module = require('node:module')
const fs = require('node:fs')
let plan = {}
try { plan = JSON.parse(process.env.BREAKWRIGHT_PLAN || '{}') } catch { /* no plan: record only */ }
const logFile = process.env.BREAKWRIGHT_LOG
const write = (o) => { if (logFile) try { fs.appendFileSync(logFile, JSON.stringify(o) + '\n') } catch { /* keep the test going */ } }

// Ids, uuids and long hashes become ":id" so the same endpoint matches across runs.
const pathKey = (u) => { try { return new URL(u).pathname.split('/').map((s) => (/^(\d+|[0-9a-f]{8,}|[0-9a-f-]{32,})$/i.test(s) ? ':id' : s)).join('/') } catch { return u } }
const keyOf = (req) => req.method() + ' ' + pathKey(req.url())

function mutate(v) {
  if (typeof v === 'string') return v === '' || /^\d{4}-\d\d-\d\dT/.test(v) || /^https?:/.test(v) ? v : v + '~breakwright'
  if (typeof v === 'number') return v + 7
  if (Array.isArray(v)) return v.map(mutate)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, /^(id|_id|uuid|type|kind)$|Id$|_id$/.test(k) ? x : mutate(x)]))
  return v
}

function clickProbe({ target, record }) {
  const name = (el) => {
    const e = el.closest('button,a,[role=button],[role=link],[role=menuitem],[role=tab],[role=checkbox],input,select,label,summary') || el
    const text = (e.getAttribute('aria-label') || e.value && e.type === 'submit' && e.value || e.textContent || e.getAttribute('name') || e.id || '').trim().replace(/\s+/g, ' ').slice(0, 60)
    return (e.getAttribute('role') || e.tagName.toLowerCase()) + ' "' + text + '"'
  }
  const block = (ev) => {
    if (!ev.isTrusted || !(ev.target instanceof Element)) return
    const k = name(ev.target)
    if (target && k === target) {
      ev.preventDefault(); ev.stopImmediatePropagation()
      if (ev.type === 'click') globalThis.__breakwrightNote && globalThis.__breakwrightNote({ t: 'hit' })
    } else if (record && ev.type === 'click') globalThis.__breakwrightNote && globalThis.__breakwrightNote({ t: 'click', key: k })
  }
  for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) window.addEventListener(t, block, true)
}

let api = null
const testInfo = () => { try { return api && api.test.info() } catch { return null } }
const done = new WeakSet()
async function setup(ctx) {
  if (!ctx || done.has(ctx)) return
  done.add(ctx)
  // With several faults, each repeat of the test gets its own; the repeats after the last fault run clean.
  const info = testInfo(), at = info ? info.repeatEachIndex : 0
  const f = plan.faults ? plan.faults[at] : plan.fault
  const log = (o) => write(plan.faults ? { ...o, i: at } : o)
  if (plan.faults) log({ t: 'ctx', id: info ? info.testId : '' })
  await ctx.exposeBinding('__breakwrightNote', (_s, o) => log(o)).catch(() => {})
  await ctx.addInitScript(clickProbe, { target: f && f.kind === 'dead-action' ? f.key : null, record: !f })
  if (!f) {
    ctx.on('response', (res) => {
      const req = res.request()
      if (!['fetch', 'xhr'].includes(req.resourceType())) return
      log({ t: 'api', key: keyOf(req), status: res.status(), json: /json/.test(res.headers()['content-type'] || '') })
    })
    return
  }
  if (f.kind === 'slow') return ctx.route('**/*', async (r) => { if (['fetch', 'xhr'].includes(r.request().resourceType())) { log({ t: 'hit' }); await new Promise((d) => setTimeout(d, f.ms || 1500)) } await r.fallback().catch(() => {}) })
  if (f.kind === 'dead-action') return
  await ctx.route('**/*', async (r) => {
    const req = r.request()
    if (!['fetch', 'xhr'].includes(req.resourceType()) || keyOf(req) !== f.key) return r.fallback()
    try {
      if (f.kind === 'fail') { await r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"breakwright fault"}' }); return log({ t: 'hit' }) }
      const res = await r.fetch()
      const before = await res.json()
      const after = f.kind === 'empty' ? (Array.isArray(before) ? [] : {}) : mutate(before)
      await r.fulfill({ response: res, json: after })
      if (JSON.stringify(before) !== JSON.stringify(after)) log({ t: 'hit' })
    } catch { await r.fallback().catch(() => {}) }
  })
}

function patchBrowser(b) {
  if (!b || b.__breakwright) return b
  b.__breakwright = true
  for (const m of ['newContext', '_newContextForReuse']) {
    if (typeof b[m] !== 'function') continue
    const orig = b[m]
    b[m] = async function (...a) { if (plan.storage && !(a[0] && a[0].storageState)) a[0] = { ...a[0], storageState: plan.storage }; const c = await orig.apply(this, a); await setup(c); return c }
  }
  return b
}
const patched = new WeakSet()
function patchApi(pw) {
  for (const n of ['chromium', 'firefox', 'webkit']) {
    let t; try { t = pw && pw[n] } catch { continue }
    if (!t || patched.has(t)) continue
    patched.add(t)
    for (const m of ['launch', 'connect', 'connectOverCDP']) if (typeof t[m] === 'function') { const o = t[m]; t[m] = async function (...a) { return patchBrowser(await o.apply(this, a)) } }
    if (typeof t.launchPersistentContext === 'function') { const o = t.launchPersistentContext; t.launchPersistentContext = async function (...a) { const c = await o.apply(this, a); await setup(c); return c } }
  }
}
if (process.env.BREAKWRIGHT_LOG || process.env.BREAKWRIGHT_PLAN) {
  const seen = (m) => { if (m && (typeof m === 'object' || typeof m === 'function')) { if (m.test && typeof m.test.info === 'function') { api = m; write({ t: 'attached' }) } patchApi(m) } }
  const orig = Module._load
  Module._load = function (id, ...rest) {
    const m = orig.call(this, id, ...rest)
    if (/playwright/.test(id)) seen(m)
    return m
  }
  // On some Node versions (22.16, 24.0) an ES module importing Playwright never goes through Module._load.
  if (typeof Module.registerHooks === 'function') {
    globalThis.__breakwrightSeen = seen
    Module.registerHooks({
      load(url, ctx, next) {
        const r = next(url, ctx)
        if (/\/node_modules\/(playwright|playwright-core|@playwright\/test)\/(index|test|lib\/index)\.js$/.test(url) && r.source && r.format === 'commonjs') {
          const src = typeof r.source === 'string' ? r.source : Buffer.from(r.source).toString('utf8')
          return { ...r, source: src + '\n;globalThis.__breakwrightSeen && globalThis.__breakwrightSeen(module.exports);\n' }
        }
        return r
      },
    })
  }
}
