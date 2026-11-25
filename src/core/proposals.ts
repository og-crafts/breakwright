/** A proposed change to a spec. Assistants can make these; only a person can apply one. */
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { audit, guard, type Finding } from './audit'
import { dataDir, specPath, TMP, writeSpec, type Project } from './project'
import { queued, runNow, type RunResult } from './run'
import { ast, hash, parseSpec } from './steps'

export interface Trial { ok: boolean; passed: number; failed: number; message?: string; runId: string }
export interface Proposal { id: string; file: string; title: string; why: string; by: string; at: string; before: string | null; after: string; baseHash: string | null; weaker: Finding[]; audit: Finding[]; state: 'open' | 'applied' | 'declined'; trial?: Trial; stale?: boolean }

const dir = (p: Project) => dataDir(p, 'proposals')
const path = (p: Project, id: string) => { if (!/^[a-z0-9-]{6,40}$/.test(id)) throw new Error('Unknown proposal.'); return join(dir(p), `${id}.json`) }
const save = (p: Project, x: Proposal) => writeFileSync(path(p, x.id), JSON.stringify(x))
const current = (p: Project, file: string) => { const f = specPath(p, file); return existsSync(f) ? readFileSync(f, 'utf8') : null }

export function propose(p: Project, o: { file: string; after: string; title: string; why: string; by: string }): Proposal {
  if (o.after.length > 400_000) throw new Error('That file is too large.')
  const before = current(p, o.file)
  try { ast(o.after) } catch (e) { throw new Error(`The proposed file has a syntax error: ${(e as Error).message}`) }
  if (!parseSpec(o.after).tests.length) throw new Error('The proposed file has no tests.')
  if (before === o.after) throw new Error('That changes nothing.')
  const x: Proposal = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, file: o.file, title: o.title.slice(0, 200), why: o.why.slice(0, 4000), by: o.by, at: new Date().toISOString(), before, after: o.after, baseHash: before === null ? null : hash(before), weaker: before === null ? [] : guard(before, o.after), audit: audit(o.after), state: 'open' }
  save(p, x); return x
}
/** Replace one exact piece of text. */
export function replaceOnce(src: string, find: string, replace: string) {
  // Assistants write \n; a file checked out on Windows has \r\n. Match it and keep the file's own line endings.
  if (src.includes('\r\n')) { const crlf = (x: string) => x.replace(/\r?\n/g, '\r\n'); find = crlf(find); replace = crlf(replace) }
  const n = src.split(find).length - 1
  if (!find || n === 0) throw new Error('The text to replace isn’t in the file.')
  if (n > 1) throw new Error(`The text to replace appears ${n} times. Include more of it.`)
  return src.replace(find, () => replace)
}
export function getProposal(p: Project, id: string): Proposal {
  const x: Proposal = JSON.parse(readFileSync(path(p, id), 'utf8'))
  const now = current(p, x.file)
  x.stale = x.state === 'open' && (now === null ? null : hash(now)) !== x.baseHash
  return x
}
export const listProposals = (p: Project) => readdirSync(dir(p)).filter((f) => f.endsWith('.json')).map((f) => getProposal(p, f.slice(0, -5))).sort((a, b) => b.at.localeCompare(a.at))
export function decline(p: Project, id: string) { const x = getProposal(p, id); if (x.state !== 'open') throw new Error('Already decided.'); x.state = 'declined'; save(p, x); return x }
/** `acceptWeaker` must be the number of weakening findings the person was shown. */
export function apply(p: Project, id: string, acceptWeaker = 0) {
  const x = getProposal(p, id)
  if (x.state !== 'open') throw new Error('Already decided.')
  if (x.stale) throw new Error('The file changed since this was proposed.')
  const weaker = x.before === null ? [] : guard(x.before, x.after)
  if (weaker.length && acceptWeaker !== weaker.length) throw new Error(`This makes the test weaker in ${weaker.length} way${weaker.length > 1 ? 's' : ''}. Accept that first.`)
  writeSpec(p, x.file, x.after, x.baseHash)
  x.state = 'applied'; save(p, x); return x
}
/** Runs the proposed file as a copy next to the original. This executes the proposed code, so a person starts it. */
export const tryOut = (p: Project, id: string, signal?: AbortSignal) => queued(async (): Promise<Proposal> => {
  const x = getProposal(p, id)
  const f = specPath(p, x.file), copy = join(dirname(f), TMP + basename(f))
  writeFileSync(copy, x.after, { flag: 'wx' })
  let r: RunResult
  try { r = await runNow(p, { targets: [{ file: (dirname(x.file) === '.' ? '' : dirname(x.file) + '/') + TMP + basename(x.file) }], retries: 0, workers: 1, signal }) } finally { rmSync(copy, { force: true }) }
  const failed = r.results.filter((t) => !t.expected || t.flaky)
  x.trial = { ok: r.ok && !failed.length, passed: r.results.filter((t) => t.status === 'passed').length, failed: failed.length, message: r.problem ?? failed[0]?.attempts.flatMap((a) => a.errors)[0]?.message.slice(0, 1500), runId: r.id }
  save(p, x); return x
})
