/** Sign-in helpers: saved browser state, one-time codes, and a local inbox for sign-in e-mails. */
import { createHmac } from 'node:crypto'
import { chmodSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { join } from 'node:path'
import { dataDir, type Project } from './project'

export function totp(secret: string, at = Date.now(), digits = 6, step = 30) {
  const clean = secret.toUpperCase().replace(/[\s=-]/g, '')
  if (!clean || /[^A-Z2-7]/.test(clean)) throw new Error('The secret isn’t base32.')
  let bits = ''; for (const c of clean) bits += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0')
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)))
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / step)))
  const h = createHmac('sha1', key).update(msg).digest(), o = h[19] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 10 ** digits).padStart(digits, '0')
}
export interface Profile { name: string; cookies: number; expires: string | null; expired: boolean }
export const profilePath = (p: Project, name: string) => { if (!/^[\w-]{1,40}$/.test(name)) throw new Error('Use letters, numbers, - and _.'); return join(dataDir(p, 'auth'), `${name}.json`) }
export function profiles(p: Project): Profile[] {
  return readdirSync(dataDir(p, 'auth')).filter((f) => f.endsWith('.json')).map((f) => {
    const full = join(dataDir(p, 'auth'), f); chmodSync(full, 0o600)
    let st: any = {}; try { st = JSON.parse(readFileSync(full, 'utf8')) } catch { /* half-written */ }
    const ex = (st.cookies ?? []).map((c: any) => c.expires).filter((x: number) => x > 0)
    const last = ex.length ? Math.max(...ex) * 1000 : null
    return { name: f.slice(0, -5), cookies: (st.cookies ?? []).length, expires: last ? new Date(last).toISOString() : null, expired: last !== null && last < Date.now() }
  })
}
export const removeProfile = (p: Project, name: string) => { const f = profilePath(p, name); if (existsSync(f)) rmSync(f) }

export interface Mail { id: number; at: string; from: string; to: string[]; subject: string; text: string; codes: string[]; links: string[] }
/** Accepts mail on 127.0.0.1 only, keeps the last 100 in memory, sends nothing on. */
export class Inbox {
  mails: Mail[] = []; private server: Server | null = null; private n = 0; port = 0
  async start(port = 0) {
    if (this.server) return this.port
    const server = createServer((s) => this.talk(s))
    await new Promise<void>((ok, no) => { server.once('error', no); server.listen(port, '127.0.0.1', ok) })
    this.server = server
    return (this.port = (server.address() as { port: number }).port)
  }
  stop() { this.server?.close(); this.server = null; this.port = 0 }
  latest(to?: string, after = 0) { return this.mails.findLast((m) => m.id > after && (!to || m.to.some((x) => x.toLowerCase() === to.toLowerCase()))) }
  private talk(s: Socket) {
    let buf = '', data: string[] | null = null, from = '', to: string[] = [], size = 0
    const say = (x: string) => s.write(x + '\r\n')
    s.on('error', () => {}); s.setTimeout(30_000, () => s.destroy()); s.setEncoding('utf8'); say('220 breakwright')
    s.on('data', (d) => {
      buf += d; size += String(d).length; if (size > 5_000_000) return s.destroy()
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1)
        if (data) { if (line === '.') { this.keep(from, to, data.join('\n')); data = null; to = []; size = 0; say('250 kept') } else data.push(line.startsWith('..') ? line.slice(1) : line); continue }
        const c = line.toUpperCase()
        if (c.startsWith('EHLO') || c.startsWith('HELO')) say('250 breakwright')
        else if (c.startsWith('MAIL FROM')) { from = line.match(/<(.*?)>/)?.[1] ?? ''; say('250 ok') }
        else if (c.startsWith('RCPT TO')) { to.push(line.match(/<(.*?)>/)?.[1] ?? ''); say('250 ok') }
        else if (c === 'DATA') { data = []; say('354 go on') }
        else if (c === 'QUIT') { say('221 bye'); s.end() }
        else if (c === 'RSET' || c === 'NOOP') { if (c === 'RSET') { from = ''; to = [] } say('250 ok') }
        else say('502 not supported')
      }
    })
  }
  private keep(from: string, to: string[], raw: string) {
    const text = body(raw), head = raw.split(/\n\n/)[0].replace(/\n[ \t]+/g, ' ')
    const subject = head.match(/^subject:\s*(.*)$/im)?.[1] ?? ''
    this.mails.push({ id: ++this.n, at: new Date().toISOString(), from, to, subject, text: text.slice(0, 50_000), codes: [...new Set((subject + ' ' + text.replace(/https?:\S+/g, '')).match(/\b\d{4,8}\b/g) ?? [])], links: [...new Set(text.match(/https?:\/\/[^\s"'<>]+/g) ?? [])] })
    if (this.mails.length > 100) this.mails.shift()
  }
}
function body(raw: string): string {
  const [h, ...rest] = raw.split('\n\n'); const b = rest.join('\n\n'), head = h.replace(/\n[ \t]+/g, ' ')
  const bound = head.match(/boundary="?([^";\n]+)"?/i)?.[1]
  if (bound) { const parts = b.split(`--${bound}`).slice(1, -1).map((x) => x.replace(/^\n/, '')); const t = parts.find((x) => /text\/plain/i.test(x.split('\n\n')[0])) ?? parts[0]; return t ? body(t) : '' }
  let out = b
  if (/content-transfer-encoding:\s*base64/i.test(head)) out = Buffer.from(b, 'base64').toString('utf8')
  else if (/content-transfer-encoding:\s*quoted-printable/i.test(head)) out = Buffer.from(b.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, x) => String.fromCharCode(parseInt(x, 16))), 'latin1').toString('utf8')
  return /text\/html/i.test(head) ? out.replace(/<a\b[^>]*href="([^"]+)"[^>]*>/gi, ' $1 ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&') : out
}
export const HELPERS = `// Plain helpers for sign-in tests. They need no extra package, so your tests run anywhere.
import { createHmac } from 'node:crypto'

/** The current one-time code for an authenticator secret (keep the secret in an environment variable). */
export function totp(secret: string, at = Date.now()) {
  const bits = [...secret.toUpperCase().replace(/[\\s=-]/g, '')].map((c) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0')).join('')
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)))
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(at / 30000)))
  const h = createHmac('sha1', key).update(msg).digest(), o = h[19] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0')
}

/** Waits for a message in the local inbox (BREAKWRIGHT_INBOX is its address) and returns it with its codes and links. */
export async function mailFor(to: string, after = 0, timeout = 15000): Promise<{ id: number; subject: string; text: string; codes: string[]; links: string[] }> {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    const r = await fetch(\`\${process.env.BREAKWRIGHT_INBOX}/latest?to=\${encodeURIComponent(to)}&after=\${after}\`)
    if (r.status === 200) return r.json()
    await new Promise((d) => setTimeout(d, 300))
  }
  throw new Error('No message arrived for ' + to)
}
`
