/** The local app server: 127.0.0.1 only, a fresh token each start, own Host and Origin only. */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { audit } from './core/audit'
import { chat, checkConnection, type Connection, type Session } from './core/assistant'
import { faultCheck, type FaultReport } from './core/faults'
import { flakeLab } from './core/flake'
import { dataDir, inside, listSpecFiles, openProject, readSpec, sweep, writeSpec, type Project } from './core/project'
import { apply, decline, getProposal, listProposals, propose, tryOut } from './core/proposals'
import { childEnv, explain, listRuns, loadRun, run } from './core/run'
import { HELPERS, Inbox, profilePath, profiles, removeProfile } from './core/signin'
import { editStep, insertStep, moveStep } from './core/steps'
import type { Grants } from './core/tools'

const here = dirname(fileURLToPath(import.meta.url))
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json' }
const CSP = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
const confDir = () => process.env.BREAKWRIGHT_HOME ?? join(homedir(), '.config', 'breakwright')
const conf = () => { try { return JSON.parse(readFileSync(join(confDir(), 'state.json'), 'utf8')) } catch { return { trusted: [], recent: [] } } }
const saveConf = (c: object) => { mkdirSync(confDir(), { recursive: true, mode: 0o700 }); writeFileSync(join(confDir(), 'state.json'), JSON.stringify(c), { mode: 0o600 }) }

export interface AppServer { url: string; port: number; token: string; close: () => Promise<void> }
export async function startServer(o: { port?: number; project?: string; token?: string } = {}): Promise<AppServer> {
  const token = o.token ?? randomBytes(24).toString('hex')
  let project: Project | null = null
  let conn: Connection | null = process.env.ANTHROPIC_API_KEY ? { kind: 'anthropic', model: 'claude-opus-5-5', key: process.env.ANTHROPIC_API_KEY } : null
  let session: Session = { messages: [], used: { input: 0, output: 0 } }
  let sites: string[] = []
  const inbox = new Inbox(), inboxKey = randomBytes(16).toString('hex')
  const jobs = new Set<AbortController>()
  const asks = new Map<string, (yes: boolean) => void>()
  const kids = new Set<ChildProcess>()
  const trusted = () => !!project && conf().trusted.includes(project.root)
  const need = () => { if (!project) throw new Error('Open a project first.'); return project }
  const needTrust = () => { const p = need(); if (!trusted()) throw new Error('Trust this project first: running tests runs its code.'); return p }
  const open = (dir: string) => {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error('That folder doesn’t exist.')
    stopAll(); project = openProject(dir); session = { messages: [], used: { input: 0, output: 0 } }
    const c = conf(); c.recent = [project.root, ...(c.recent ?? []).filter((x: string) => x !== project!.root)].slice(0, 8); saveConf(c)
    const base = project.config && readFileSync(join(project.root, project.config), 'utf8').match(/baseURL:\s*['"`](https?:\/\/[^'"`$]+)/)?.[1]
    sites = base ? [new URL(base).origin] : []
    if (trusted()) sweep(project)
  }
  const stopAll = () => { for (const j of jobs) j.abort(); for (const [, f] of asks) f(false); asks.clear() }
  const state = () => ({ project: project && { root: project.root, config: project.config, version: project.version, problem: project.problem, trusted: trusted() }, recent: conf().recent ?? [], sites, connection: conn && { kind: conn.kind, model: conn.model, baseUrl: conn.baseUrl }, used: session.used, inbox: inbox.port ? { smtp: inbox.port } : null, canRecord: process.platform !== 'linux' || !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY), cli: join(here, 'cli.mjs') })
  const view = (file: string) => { const p = need(), sp = readSpec(p, file); return { file, ...sp, audit: sp.error ? [] : audit(sp.src) } }
  const inRuns = (p: Project, f: string) => f.startsWith(join(p.root, '.breakwright', 'runs') + sep)
  const proofFile = (p: Project) => join(dataDir(p, 'proof'), 'reports.json')
  const proofs = (p: Project): Record<string, FaultReport & { at: string; hash: string }> => { try { return JSON.parse(readFileSync(proofFile(p), 'utf8')) } catch { return {} } }

  /** Plain request → JSON answer */
  const api: Record<string, (b: any) => any> = {
    state: () => state(),
    open: (b) => { open(String(b.dir)); return state() },
    trust: () => { const p = need(); const c = conf(); c.trusted = [...new Set([...(c.trusted ?? []), p.root])]; saveConf(c); sweep(p); return state() },
    folders: (b) => { const d = realpathSync(resolve(b.dir || homedir())); return { dir: d, parent: dirname(d), list: readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules').map((e) => ({ name: e.name, path: join(d, e.name), project: ['ts', 'js', 'mjs', 'mts'].some((x) => existsSync(join(d, e.name, `playwright.config.${x}`))) })).sort((a, z) => +z.project - +a.project || a.name.localeCompare(z.name)) } },
    specs: () => { const p = need(); const pr = proofs(p); return listSpecFiles(p).map((f) => { const s = readSpec(p, f); const a = s.error ? [] : audit(s.src); return { file: f, error: s.error, tests: (s.tests ?? []).map((t) => ({ title: t.title, line: t.line, describe: t.describe, weak: a.filter((x) => x.test === t.title).length, proof: pr[`${f}|${t.title}`] && { caught: pr[`${f}|${t.title}`].caught, tried: pr[`${f}|${t.title}`].tried, old: pr[`${f}|${t.title}`].hash !== s.hash } })) } }) },
    spec: (b) => view(b.file),
    step: (b) => {
      const p = need(), s = readSpec(p, b.file)
      const next = b.op === 'insert' ? insertStep(s.src, b.test, b.line, b.index, b.step) : b.op === 'move' ? moveStep(s.src, b.test, b.line, b.index, b.by) : editStep(s.src, b.test, b.line, b.index, b.op === 'delete' ? null : b.step)
      writeSpec(p, b.file, next, b.hash); return view(b.file)
    },
    save: (b) => { writeSpec(need(), b.file, b.src, b.hash); return view(b.file) },
    newSpec: (b) => { const f = /\.(spec|test)\.[cm]?[jt]sx?$/.test(b.file) ? b.file : `${b.file}.spec.ts`; writeSpec(need(), f, `import { test, expect } from '@playwright/test'\n\ntest(${JSON.stringify(b.title || 'new test')}, async ({ page }) => {\n  await page.goto('/')\n})\n`, null); return view(f) },
    runs: () => listRuns(need()),
    runDetail: (b) => { const r = loadRun(need(), b.id); return { ...r, output: r.output.slice(-4000), results: r.results.map((t) => ({ ...t, why: t.expected && !t.flaky ? null : explain(t), attempts: t.attempts.map((a) => ({ ...a, attachments: a.attachments.map((x) => ({ name: x.name, type: x.type, rel: x.path ? relative(need().root, x.path).split(sep).join('/') : null })) })) })) } },
    proof: (b) => proofs(need())[`${b.file}|${b.test}`] ?? null,
    proposals: () => listProposals(need()).map(({ before, after, ...x }) => x),
    proposal: (b) => getProposal(need(), b.id),
    applyProposal: (b) => apply(need(), b.id, b.acceptWeaker),
    declineProposal: (b) => decline(need(), b.id),
    profiles: () => profiles(need()),
    removeProfile: (b) => { removeProfile(need(), b.name); return profiles(need()) },
    sites: (b) => { sites = (b.sites as string[]).filter(Boolean).map((s) => new URL(s).origin); return state() },
    connect: (b) => { const c: Connection | null = b.connection; if (c) { const e = checkConnection(c); if (e) throw new Error(e) } conn = c; session = { messages: [], used: { input: 0, output: 0 } }; return state() },
    newChat: () => { session = { messages: [], used: { input: 0, output: 0 } }; return state() },
    answer: (b) => { const f = asks.get(b.id); asks.delete(b.id); f?.(b.yes === true); return {} },
    stop: () => { stopAll(); return {} },
    inbox: async (b) => { if (b.on === true) await inbox.start(b.port ?? 0); if (b.on === false) inbox.stop(); return { smtp: inbox.port || null, mails: [...inbox.mails].reverse() } },
    helpers: () => { const p = need(), f = join(p.root, 'breakwright-helpers.ts'); if (existsSync(f)) throw new Error('breakwright-helpers.ts is already there.'); writeFileSync(f, HELPERS, { flag: 'wx' }); return { file: 'breakwright-helpers.ts' } },
    trace: (b) => { const p = needTrust(), f = inside(p, b.rel); if (!inRuns(p, f) || !f.endsWith('.zip')) throw new Error('Not a trace.'); pw(p, ['show-trace', f]); return {} },
    record: (b) => {
      const p = needTrust(); new URL(b.url)
      if (!/^https?:/.test(b.url)) throw new Error('Use a full http or https address.')
      const out = join(dataDir(p, 'tmp'), `rec-${Date.now()}.spec.ts`)
      const c = pw(p, ['codegen', '--target', 'playwright-test', '--output', out, ...(b.profile ? ['--load-storage', profilePath(p, b.profile)] : []), b.url])
      c.on('close', () => { if (existsSync(out)) { try { propose(p, { file: b.file, after: readFileSync(out, 'utf8'), title: `Recording of ${b.url}`, why: 'Recorded by you. Add checks before you rely on it.', by: 'recorder' }) } catch { /* nothing recorded */ } rmSync(out, { force: true }) } })
      return {}
    },
    capture: (b) => { const p = needTrust(); if (!/^https?:/.test(b.url)) throw new Error('Use a full http or https address.'); pw(p, ['open', '--save-storage', profilePath(p, b.name), b.url]); return {} },
  }
  const pw = (p: Project, args: string[]) => { if (!p.cli) throw new Error(p.problem); if (!state().canRecord) throw new Error('This needs a desktop: no display was found.'); const c = spawn(process.execPath, [p.cli, ...args], { cwd: p.root, env: childEnv() as NodeJS.ProcessEnv, stdio: 'ignore' }); kids.add(c); c.on('close', () => kids.delete(c)); c.on('error', () => kids.delete(c)); return c }

  /** Long work → JSON lines */
  const stream: Record<string, (b: any, emit: (e: object) => void, signal: AbortSignal) => Promise<void>> = {
    run: async (b, emit, signal) => { const p = needTrust(); const r = await run(p, { targets: b.targets, project: b.project || undefined, headed: !!b.headed, signal, onLine: (s) => emit({ t: 'line', s }), ...(b.profile ? { plan: { storage: profilePath(p, b.profile) } } : {}), env: inboxEnv() }); emit({ t: 'done', id: r.id, ok: r.ok, problem: r.problem }) },
    faults: async (b, emit, signal) => {
      const p = needTrust(), h = readSpec(p, b.file).hash
      const r = await faultCheck(p, { file: b.file, line: b.line }, { max: b.max ?? 12, project: b.project || undefined, signal, onProgress: (done, total, outcome) => emit({ t: 'progress', done, total, outcome }) })
      if (!r.stopped && r.baseline === 'passed') { const all = proofs(p); all[`${b.file}|${b.test}`] = { ...r, at: new Date().toISOString(), hash: h }; writeFileSync(proofFile(p), JSON.stringify(all)) }
      emit({ t: 'done', report: r })
    },
    flake: async (b, emit, signal) => { const r = await flakeLab(needTrust(), { file: b.file, line: b.line }, { repeat: Math.min(50, b.repeat ?? 10), project: b.project || undefined, signal }); emit({ t: 'done', report: r }) },
    tryProposal: async (b, emit, signal) => { emit({ t: 'done', proposal: await tryOut(needTrust(), b.id, signal) }) },
    chat: async (b, emit, signal) => {
      const p = need()
      if (!conn) throw new Error('Connect a model first.')
      const grants: Grants = { run: trusted(), propose: true, runProposals: trusted(), sites: trusted() ? sites : [] }
      await chat(session, conn, { project: p, grants, by: 'assistant', secrets: [conn.key, token], signal }, String(b.text), { emit, signal, approve: (_n, _a, ask) => new Promise((done) => { const id = randomUUID(); asks.set(id, done); signal.addEventListener('abort', () => { asks.delete(id); done(false) }, { once: true }); ask(id) }) })
    },
  }
  const inboxEnv = (): Record<string, string> => (inbox.port ? { BREAKWRIGHT_INBOX: `http://127.0.0.1:${port()}/inbox/${inboxKey}`, BREAKWRIGHT_SMTP_PORT: String(inbox.port) } : {})
  const server = createServer((q, r) => void handle(q, r).catch(() => { if (!r.headersSent) r.writeHead(500); r.end() }))
  const port = () => (server.address() as { port: number }).port
  const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
  async function handle(q: IncomingMessage, r: ServerResponse) {
    r.setHeader('X-Content-Type-Options', 'nosniff'); r.setHeader('Referrer-Policy', 'no-referrer'); r.setHeader('Cache-Control', 'no-store')
    const json = (code: number, d: unknown) => { r.writeHead(code, { 'content-type': 'application/json' }); r.end(JSON.stringify(d)) }
    const hosts = [`127.0.0.1:${port()}`, `localhost:${port()}`]
    if (!hosts.includes(q.headers.host ?? '')) return json(403, { error: 'Wrong host.' })
    if (q.headers.origin && !hosts.some((h) => q.headers.origin === `http://${h}`)) return json(403, { error: 'Wrong origin.' })
    const u = new URL(q.url ?? '/', 'http://x'), auth = (q.headers.authorization ?? '').replace(/^Bearer /, '')
    // Tests read mail with a separate, read-only path.
    if (u.pathname === `/inbox/${inboxKey}/latest`) { const m = inbox.latest(u.searchParams.get('to') ?? undefined, +(u.searchParams.get('after') ?? 0)); return m ? json(200, m) : json(404, {}) }
    if (u.pathname.startsWith('/api/')) {
      if (!same(auth, token)) return json(401, { error: 'Open Breakwright from its own window or link.' })
      if (u.pathname === '/api/file' && q.method === 'GET') {
        const rel = u.searchParams.get('rel') ?? ''
        try { const f = inside(need(), rel); if (!inRuns(need(), f) || !/\.(png|webp|jpe?g)$/.test(f)) throw 0; r.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'image/jpeg' }); return void createReadStream(f).on('error', () => r.end()).pipe(r) } catch { return json(404, {}) }
      }
      if (q.method !== 'POST') return json(405, {})
      let raw = ''; for await (const c of q) { raw += c; if (raw.length > 2_000_000) return json(413, { error: 'Too large.' }) }
      let body: any; try { body = raw ? JSON.parse(raw) : {} } catch { return json(400, { error: 'Bad request.' }) }
      const name = u.pathname.slice(5)
      if (Object.hasOwn(api, name)) { try { return json(200, (await api[name](body)) ?? {}) } catch (e) { return json(400, { error: (e as Error).message }) } }
      if (Object.hasOwn(stream, name)) {
        r.writeHead(200, { 'content-type': 'application/x-ndjson' })
        const j = new AbortController(); jobs.add(j); r.on('close', () => j.abort())
        const emit = (e: object) => { if (!r.writableEnded) r.write(JSON.stringify(e) + '\n') }
        try { await stream[name](body, emit, j.signal) } catch (e) { emit({ t: 'error', message: (e as Error).message }) }
        jobs.delete(j); return void r.end()
      }
      return json(404, { error: 'Not found.' })
    }
    const ui = [join(here, 'ui'), join(here, '../dist/ui')].find(existsSync)
    if (!ui || q.method !== 'GET') { r.writeHead(404); return r.end('The interface isn’t built. Run: npm run build') }
    let f = resolve(ui, '.' + (u.pathname === '/' ? '/index.html' : u.pathname))
    if (!f.startsWith(ui + sep) || !existsSync(f)) f = join(ui, 'index.html')
    r.writeHead(200, { 'content-type': `${MIME[extname(f)] ?? 'application/octet-stream'}`, 'content-security-policy': CSP })
    createReadStream(f).pipe(r)
  }
  await new Promise<void>((ok, no) => { server.once('error', no); server.listen(o.port ?? 0, '127.0.0.1', ok) })
  if (o.project) open(o.project)
  return { port: port(), token, url: `http://127.0.0.1:${port()}/#${token}`, close: async () => { stopAll(); inbox.stop(); for (const k of kids) k.kill(); server.closeAllConnections(); await new Promise((d) => server.close(d)) } }
}
