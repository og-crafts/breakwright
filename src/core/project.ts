/** A folder with a Playwright project. Opening only reads files; listing or running executes the project's code. */
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync, renameSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { hash, parseSpec, type Spec } from './steps'

export interface Project { root: string; config: string | null; cli: string | null; version: string | null; problem?: string }
const CONFIGS = ['ts', 'js', 'mts', 'mjs', 'cts', 'cjs'].map((e) => `playwright.config.${e}`)
export const TMP = 'breakwright-tmp-'

export function openProject(dir: string): Project {
  const root = realpathSync(resolve(dir))
  const config = CONFIGS.find((c) => existsSync(join(root, c))) ?? null
  let cli: string | null = null, version: string | null = null
  try {
    const req = createRequire(join(root, 'package.json'))
    const pkg = req.resolve('@playwright/test/package.json')
    cli = join(dirname(pkg), 'cli.js'); version = JSON.parse(readFileSync(pkg, 'utf8')).version
  } catch { /* not installed */ }
  const problem = !config ? 'No Playwright config found in this folder.' : !cli ? 'Playwright isn’t installed here. Run: npm install -D @playwright/test' : undefined
  const p = { root, config, cli, version, problem }
  return p
}
export const dataDir = (p: Project, ...more: string[]) => {
  const d = join(p.root, '.breakwright'); mkdirSync(d, { recursive: true })
  const gi = join(d, '.gitignore'); if (!existsSync(gi)) writeFileSync(gi, '*\n')
  const out = join(d, ...more); mkdirSync(out, { recursive: true }); return out
}
export function listSpecFiles(p: Project): string[] {
  const out: string[] = []
  const walk = (d: string, depth: number) => {
    if (depth > 8) return
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || ['node_modules', 'dist', 'build', 'test-results', 'playwright-report'].includes(e.name)) continue
      const f = join(d, e.name)
      if (e.isDirectory()) walk(f, depth + 1)
      else if (/\.(spec|test)\.[cm]?[jt]sx?$/.test(e.name) && !e.name.startsWith(TMP)) out.push(relative(p.root, f).split(sep).join('/'))
    }
  }
  walk(p.root, 0)
  return out.sort()
}
/** A path inside the project, following links; refuses anything that escapes it. */
export function inside(p: Project, file: string): string {
  if (isAbsolute(file) || file.includes('\0')) throw new Error('Use a path inside the project.')
  const full = resolve(p.root, file)
  let probe = full
  while (!existsSync(probe)) probe = dirname(probe)
  const rel = relative(p.root, join(realpathSync(probe), relative(probe, full)))
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new Error('That path is outside the project.')
  return full
}
export function specPath(p: Project, file: string) {
  if (!/\.(spec|test)\.[cm]?[jt]sx?$/.test(file) || /(^|[\\/])(node_modules|\.[^\\/]+)[\\/]/.test(file)) throw new Error('Only test files (.spec or .test) can be opened.')
  return inside(p, file)
}
export const readSpec = (p: Project, file: string): { src: string } & Partial<Spec> & { hash: string; error?: string } => {
  const src = readFileSync(specPath(p, file), 'utf8')
  try { return { src, ...parseSpec(src) } } catch (e) { return { src, tests: [], hash: hash(src), error: (e as Error).message } }
}
/** Saves only if the file is still what the caller read. */
export function writeSpec(p: Project, file: string, next: string, expectHash: string | null) {
  const f = specPath(p, file)
  if (existsSync(f)) { if (expectHash === null) throw new Error('That file already exists.'); if (hash(readFileSync(f, 'utf8')) !== expectHash) throw new Error('This file changed on disk. Reload it and try again.') }
  else if (expectHash !== null) throw new Error('That file is gone.')
  parseSpec(next)
  mkdirSync(dirname(f), { recursive: true })
  const tmp = `${f}.breakwright-save`; writeFileSync(tmp, next, existsSync(f) ? { mode: statSync(f).mode } : {}); renameSync(tmp, f)
}
/** Removes trial copies left by a crash. */
export function sweep(p: Project) {
  const walk = (d: string, n: number) => { if (n > 8) return; for (const e of readdirSync(d, { withFileTypes: true })) { if (e.name === 'node_modules' || e.name.startsWith('.git')) continue; const f = join(d, e.name); if (e.isDirectory()) walk(f, n + 1); else if (e.name.startsWith(TMP) && /\.(spec|test)\./.test(e.name)) rmSync(f) } }
  walk(p.root, 0)
}
