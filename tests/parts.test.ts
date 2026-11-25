import { cpSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { request } from 'node:http'
import { connect, createServer } from 'node:net'
import { createServer as http } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chat, type Event, type Session } from '../src/core/assistant'
import { openProject } from '../src/core/project'
import { apply, getProposal, propose, replaceOnce } from '../src/core/proposals'
import { Inbox, totp, HELPERS } from '../src/core/signin'
import { suggest } from '../src/core/suggest'
import { callTool, offered, TOOLS } from '../src/core/tools'
import { startServer } from '../src/server'
import { assert, describe, expect, it } from './kit'

const fresh = () => { const d = mkdtempSync(join(tmpdir(), 'breakwright-')); cpSync('examples/shop', d, { recursive: true, filter: (f) => !/\.breakwright|test-results/.test(f) }); symlinkSync(resolve('node_modules'), join(d, 'node_modules')); return openProject(d) }
const F = 'tests/shop.spec.ts'
const none = { run: false, propose: false, runProposals: false, sites: [] }
const ctx = (p: ReturnType<typeof fresh>, g = {}) => ({ project: p, grants: { ...none, ...g }, by: 'bot' })
const rejects = async (f: () => any, r: RegExp) => assert.rejects(async () => f(), r)

describe('proposals', () => {
  it('a locator repair applies; a weaker one needs the exact acceptance', async () => {
    const p = fresh(), src = readFileSync(join(p.root, F), 'utf8')
    const a = propose(p, { file: F, after: replaceOnce(src, `getByRole('button', { name: 'Sign in' })`, `getByRole('button', { name: 'Sign in now' })`), title: 't', why: 'w', by: 'bot' })
    expect(a.weaker).toEqual([])
    const b = propose(p, { file: F, after: replaceOnce(src, `toHaveText('Welcome Asha')`, `toBeVisible()`), title: 't', why: 'w', by: 'bot' })
    expect(b.weaker.length).toBe(1)
    await rejects(() => apply(p, b.id), /weaker/)
    apply(p, a.id)
    expect(getProposal(p, b.id).stale).toBe(true)
    await rejects(() => apply(p, b.id, 1), /changed since/)
    await rejects(() => apply(p, a.id), /decided/)
  })
  it('new files never overwrite', async () => { const p = fresh(); const x = propose(p, { file: 'tests/n.spec.ts', after: `import {test} from '@playwright/test'\ntest('a', async () => {})`, title: 't', why: 'w', by: 'bot' }); writeFileSync(join(p.root, 'tests/n.spec.ts'), 'mine'); await rejects(() => apply(p, x.id), /changed since/) })
})
describe('tools', () => {
  it('offers only what is granted, and no tool applies or declines', () => {
    const p = fresh()
    expect(offered(none).map((t) => t.name)).toEqual(['list_tests', 'get_test', 'get_file', 'explain_failure', 'get_proposal'])
    expect(TOOLS.some((t) => /apply|decline|accept|delete/.test(t.name))).toBe(false); void p
  })
  it('refuses ungranted, unknown and malformed calls', async () => {
    const p = fresh()
    for (const [n, a] of [['run_test', { file: F }], ['propose_test', {}], ['nope', {}], ['get_file', { file: '../../etc/passwd' }], ['get_file', { file: 'playwright.config.ts' }], ['get_test', { file: F }], ['get_test', { file: F, test: 'add a mug', extra: 1 }], ['get_test', 'x']] as const) expect((await callTool(ctx(p), n, a)).isError).toBe(true)
  })
  it('hides secrets it shows and refuses hidden text back', async () => {
    const p = fresh(); const f = join(p.root, F); writeFileSync(f, readFileSync(f, 'utf8').replace(`fill('secret')`, `fill('hunter22')`))
    const r = await callTool(ctx(p), 'get_test', { file: F, test: 'sign in greets the person' })
    expect(r.text).not.toContain('hunter22')
    const w = await callTool(ctx(p, { propose: true }), 'propose_repair', { file: F, find: `x`, replace: `<hidden>`, title: 't', why: 'w' })
    expect(w.text).toContain('hidden value')
  })
  it('proposing tells the assistant what was flagged and changes nothing', async () => {
    const p = fresh(), before = readFileSync(join(p.root, F), 'utf8')
    const r = await callTool(ctx(p, { propose: true }), 'propose_repair', { file: F, find: `  await expect(page.getByRole('status')).toHaveText('Welcome Asha')\n`, replace: '', title: 't', why: 'w' })
    expect(r.text).toContain('Flagged'); expect(readFileSync(join(p.root, F), 'utf8')).toBe(before)
  })
  it('refuses sites that are not allowed', async () => expect((await callTool(ctx(fresh(), { sites: ['http://127.0.0.1:1'] }), 'explore_page', { url: 'http://169.254.169.254/' })).text).toContain('allowed sites'))
})
describe('locator repair', () => {
  const y = `- button "Sign in to shop"\n- button "Cancel"\n- link "Sign in"`
  it('keeps the role', () => expect(suggest(`page.getByRole('button', { name: 'Sign in' })`, y).map((s) => s.locator)).toEqual([`page.getByRole('button', { name: 'Sign in to shop' })`]))
  it('says nothing when nothing is close', () => expect(suggest(`page.getByRole('button', { name: 'Archive' })`, y)).toEqual([]))
  it('does not suggest a name used twice', () => expect(suggest(`page.getByRole('button', { name: 'Save it' })`, `- button "Save"\n- button "Save"`)).toEqual([]))
})
describe('sign-in', () => {
  it('makes RFC 6238 codes', () => { const k = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; expect(totp(k, 59_000, 8)).toBe('94287082'); expect(totp(k, 1111111109_000, 8)).toBe('07081804'); expect(HELPERS).toContain('export function totp') })
  it('catches mail with codes and links', async () => {
    const i = new Inbox(), port = await i.start()
    await new Promise<void>((done) => { const s = connect(port, '127.0.0.1'); const q = ['EHLO x', 'MAIL FROM:<a@b.c>', 'RCPT TO:<me@x.y>', 'DATA', 'Subject: Your code\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nCode 482913 or http://x.y/l?t=3Dabc\r\n..dot\r\n.', 'QUIT']; s.on('data', () => { const n = q.shift(); if (n) s.write(n + '\r\n') }); s.on('close', () => done()) })
    const m = i.latest('ME@x.y')!; expect(m.codes).toEqual(['482913']); expect(m.links).toEqual(['http://x.y/l?t=abc']); expect(m.text).toContain('\n.dot'); i.stop()
  })
})
describe('server', () => {
  it('needs the token, its own host and its own origin', async () => {
    process.env.BREAKWRIGHT_HOME = mkdtempSync(join(tmpdir(), 'breakwright-h-'))
    const p = fresh(), s = await startServer({ project: p.root })
    const call = (path: string, h: Record<string, string> = {}, body = '{}') => new Promise<{ code: number; text: string }>((done) => { const r = request({ host: '127.0.0.1', port: s.port, path, method: 'POST', headers: { 'content-type': 'application/json', ...h } }, (x) => { let t = ''; x.on('data', (d) => (t += d)); x.on('end', () => done({ code: x.statusCode!, text: t })) }); r.end(body) })
    const A = { authorization: `Bearer ${s.token}` }
    expect((await call('/api/state')).code).toBe(401)
    expect((await call('/api/state', { ...A, host: 'evil.test' })).code).toBe(403)
    expect((await call('/api/state', { ...A, origin: 'http://evil.test' })).code).toBe(403)
    expect((await call('/api/state', A)).code).toBe(200)
    expect((await call('/api/constructor', A)).code).toBe(404)
    expect((await call('/api/run', A)).text).toContain('Trust this project')
    expect((await call('/api/spec', A, JSON.stringify({ file: '../x.spec.ts' }))).code).toBe(400)
    const spec = JSON.parse((await call('/api/spec', A, JSON.stringify({ file: F }))).text)
    const edit = (hash: string) => call('/api/step', A, JSON.stringify({ file: F, test: 'add a mug', hash, op: 'insert', index: 1, step: { kind: 'click', target: `page.getByText('x')` } }))
    expect((await edit('old')).text).toContain('changed on disk'); expect((await edit(spec.hash)).code).toBe(200)
    expect((await call('/api/state', A)).text).not.toContain(s.token)
    await s.close()
  })
})
describe('assistant', () => {
  const fake = async (turns: any[]) => { const seen: any[] = []; const s = http((q, r) => { let b = ''; q.on('data', (d) => (b += d)); q.on('end', () => { seen.push(JSON.parse(b)); r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(turns.shift())) }) }); await new Promise<void>((d) => s.listen(0, '127.0.0.1', () => d())); return { seen, url: `http://127.0.0.1:${(s.address() as any).port}`, close: () => s.close() } }
  const go = async (kind: 'anthropic' | 'local', turns: any[], yes: boolean, g = {}) => {
    const f = await fake(turns), ev: Event[] = [], s: Session = { messages: [], used: { input: 0, output: 0 } }; let asked = 0
    await chat(s, { kind, model: 'm', key: 'sk-test-key', baseUrl: f.url }, ctx(fresh(), g), 'hi', { emit: (e) => ev.push(e), approve: async () => { asked++; return yes }, signal: new AbortController().signal }); f.close(); return { ev, s, asked, seen: f.seen }
  }
  const msg = (content: any[], stop_reason: string) => ({ id: 'm', type: 'message', role: 'assistant', model: 'm', content, stop_reason, usage: { input_tokens: 10, output_tokens: 2 } })
  const use = (name: string, input: any) => ({ type: 'tool_use', id: 'tu1', name, input })
  it('reads without asking, answers with one result message', async () => { const r = await go('anthropic', [msg([use('list_tests', {})], 'tool_use'), msg([{ type: 'text', text: 'ok' }], 'end_turn')], false); expect(r.asked).toBe(0); expect(r.s.messages.length).toBe(4); expect(JSON.stringify(r.seen[1].messages[2])).toContain('add a mug'); expect(r.s.used.input).toBe(20) })
  it('asks before running, and takes no for an answer', async () => { const r = await go('anthropic', [msg([use('run_test', { file: F })], 'tool_use'), msg([{ type: 'text', text: 'ok' }], 'end_turn')], false, { run: true }); expect(r.asked).toBe(1); expect(JSON.stringify(r.seen[1])).toContain('said no') })
  it('never runs calls from a cut-off answer', async () => { const r = await go('anthropic', [msg([use('run_test', { file: F })], 'max_tokens')], true, { run: true }); expect(r.asked).toBe(0); expect(r.s.messages).toEqual([]) })
  it('checks arguments before asking', async () => { const r = await go('anthropic', [msg([use('run_test', { file: 3 })], 'tool_use'), msg([{ type: 'text', text: 'ok' }], 'end_turn')], true, { run: true }); expect(r.asked).toBe(0); expect(JSON.stringify(r.seen[1])).toContain('must be a string') })
  it('review: not granted means not asked', async () => { const r = await go('anthropic', [msg([use('run_test', { file: F })], 'tool_use'), msg([{ type: 'text', text: 'ok' }], 'end_turn')], true); expect(r.asked).toBe(0) })
  it('review: one message at a time', async () => { const ev: Event[] = []; await chat({ messages: [], busy: true, used: { input: 0, output: 0 } }, { kind: 'anthropic', model: 'm', key: 'k' }, ctx(fresh()), 'x', { emit: (e) => ev.push(e), approve: async () => true, signal: new AbortController().signal }); expect(ev[0].t).toBe('error') })
  it('works with a local model, incl. broken arguments', async () => { const r = await go('local', [{ choices: [{ finish_reason: 'tool_calls', message: { content: '', tool_calls: [{ id: 'a', type: 'function', function: { name: 'list_tests', arguments: '{bad' } }, { id: 'b', type: 'function', function: { name: 'list_tests', arguments: '{}' } }] } }] }, { choices: [{ finish_reason: 'stop', message: { content: 'done' } }] }], true); expect(r.s.messages.map((m) => m.role).join()).toBe('user,assistant,tool,tool,assistant'); expect(r.ev.at(-1)!.t).toBe('done') })
  it('refuses plain http to another machine', async () => { const ev: Event[] = []; await chat({ messages: [], used: { input: 0, output: 0 } }, { kind: 'local', model: 'm', key: '', baseUrl: 'http://example.com' }, ctx(fresh()), 'x', { emit: (e) => ev.push(e), approve: async () => true, signal: new AbortController().signal }); expect(ev[0].t).toBe('error') })
})
void createServer; void existsSync
