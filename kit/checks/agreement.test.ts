/** Files that must agree with each other, or a release goes out wrong. */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
const read = (f: string) => readFileSync(f, 'utf8'), json = (f: string) => JSON.parse(read(f))
const version = json('package.json').version as string, app = json('app.json'), conf = json('src-tauri/tauri.conf.json')
describe('versions', () => {
  it('are the same everywhere', () => {
    expect(conf.version).toBe(version); expect(json('package-lock.json').version).toBe(version)
    expect(read('src-tauri/Cargo.toml').match(/^\[package\][^[]*?^version = "([^"]+)"/ms)?.[1]).toBe(version)
    expect(read('Cargo.lock').match(new RegExp(`name = "${app.slug}"\nversion = "([^"]+)"`))?.[1]).toBe(version)
  })
  it('have a changelog entry on top', () => { const r = json('changelog.json').releases[0]; expect(r.version).toBe(version); expect(r.changes.length).toBeGreaterThan(0) })
})
describe('identity', () => {
  it('comes from app.json', () => { expect(conf.productName).toBe(app.name); expect(conf.identifier).toBe(app.identifier); expect(json('package.json').name).toBe(app.slug) })
  it('updates come from this app’s own releases', () => {
    const u = conf.plugins?.updater; if (u) expect(u.endpoints).toEqual([`https://github.com/${app.repo}/releases/latest/download/latest.json`])
  })
  it('the Tauri CLI and API move together', () => { const p = json('package.json'); expect(p.devDependencies['@tauri-apps/cli']).toBe(p.dependencies['@tauri-apps/api']) })
})
