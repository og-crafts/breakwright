/** The kit's own behaviour, run inside every app so a dependency bump that breaks it is seen there. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AboutDialog, app, applyTheme, checkDue, DAY, savedTheme, setApp, Shell, SplitPane, useContextMenu, useDialogs, useUpdates, type ConfirmOptions } from '../ui'

beforeEach(() => { localStorage.clear(); setApp({ name: 'Test', slug: 'test', version: '1.0.0', tagline: 't', site: 'https://x.test', repo: 'o/r', channel: 'dev', releases: [{ version: '1.0.0', date: '2026-01-01', title: 'First', changes: ['**Bold** `code`'] }] }) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ })

describe('dialogs', () => {
  function Host({ out }: { out: (v: unknown) => void }) {
    const d = useDialogs()
    return <><button onClick={() => void d.confirm({ message: 'Remove it?', ok: 'Remove', danger: true }).then(out)}>one</button><button onClick={() => void d.ask({ title: 'Name' }).then(out)}>two</button>{d.node}</>
  }
  it('names its button, marks danger, and answers', async () => {
    const out = vi.fn(); render(<Host out={out} />); fireEvent.click(screen.getByText('one'))
    const b = screen.getByRole('button', { name: 'Remove', hidden: true }); expect(b.className).toContain('danger')
    fireEvent.click(b); await waitFor(() => expect(out).toHaveBeenCalledWith(true))
  })
  it('opens on the safe button when it is dangerous, on the input when it asks, on Close in About', () => {
    render(<Host out={() => {}} />); fireEvent.click(screen.getByText('one')); expect(document.activeElement?.textContent).toBe('Cancel')
    fireEvent.click(screen.getByText('two')); expect(document.activeElement?.tagName).toBe('INPUT'); cleanup()
    render(<AboutDialog onClose={() => {}} notify={() => {}} />); expect(document.activeElement?.textContent).toBe('Close')
  })
  it('a replaced dialog counts as cancelled', async () => {
    const out = vi.fn(); render(<Host out={out} />); fireEvent.click(screen.getByText('one')); fireEvent.click(screen.getByText('two'))
    await waitFor(() => expect(out).toHaveBeenCalledWith(false))
  })
})
describe('theme', () => {
  it('falls back when the saved one is unknown', () => { localStorage.setItem('test.theme', '"neon"'); expect(savedTheme()).toBe('system') })
  it('marks the page', () => { applyTheme('dark'); expect(document.documentElement.dataset.theme).toBe('dark'); applyTheme('system'); expect(document.documentElement.dataset.theme).toBeUndefined() })
})
describe('sizes from the keyboard', () => {
  it('moves the divider and remembers it', () => {
    render(<SplitPane id="a" label="Resize" first={1} second={2} />); const s = screen.getByRole('separator')
    fireEvent.keyDown(s, { key: 'End' }); expect(s.getAttribute('aria-valuenow')).toBe('85'); expect(localStorage.getItem('test.split.a')).toBe('0.85')
  })
  it('resizes, folds and opens the library', () => {
    const pick = vi.fn(); render(<Shell sections={[{ id: 'a', label: 'Items', library: <p>list</p> }, { id: 'b', label: 'Page' }]} active="a" onPick={pick} work={null} />)
    const s = screen.getByRole('separator'); fireEvent.keyDown(s, { key: 'Home' }); expect(s.getAttribute('aria-valuenow')).toBe('200')
    fireEvent.click(screen.getByRole('button', { name: 'Items' })); expect(screen.queryByText('list')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Items' })); expect(screen.getByText('list')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Page' })); expect(pick).toHaveBeenCalledWith('b')
  })
})
it('a right-click menu works from the keyboard and closes on Escape', () => {
  const run = vi.fn()
  function Host() { const m = useContextMenu(); return <><button onContextMenu={(e) => m.open(e, [{ label: 'One', run }, '-', { label: 'Two', run }])}>here</button>{m.node}</> }
  render(<Host />); fireEvent.contextMenu(screen.getByText('here'))
  expect(document.activeElement?.textContent).toBe('One'); fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' }); expect(document.activeElement?.textContent).toBe('Two')
  fireEvent.keyDown(document, { key: 'Escape' }); expect(screen.queryByRole('menu')).toBeNull(); expect(run).not.toHaveBeenCalled()
})
it('About shows addresses as text when the page can’t open a browser', () => {
  setApp({ ...app(), links: false }); render(<AboutDialog onClose={() => {}} notify={() => {}} />)
  expect(screen.getByText('https://x.test').tagName).toBe('SPAN'); expect(screen.queryByRole('button', { name: 'Website', hidden: true })).toBeNull()
})
it('About shows the version and the changes', () => {
  render(<AboutDialog onClose={() => {}} notify={() => {}} />); expect(screen.getByText(/Test 1.0.0 \(development build\)/)).toBeTruthy(); expect(screen.getByText('Bold').tagName).toBe('B')
})
describe('updates', () => {
  it('waits for the notice, then once per start and once a day', () => {
    expect(checkDue({ enabled: true, runStartedAt: 5, now: 9 })).toBe(false)
    expect(checkDue({ enabled: true, noticeAt: 6, runStartedAt: 5, now: 9 })).toBe(false)
    expect(checkDue({ enabled: true, noticeAt: 1, runStartedAt: 5, now: 9 })).toBe(true)
    expect(checkDue({ enabled: true, noticeAt: 1, runStartedAt: 5, lastCheckAt: 9, now: 9 + DAY - 1 })).toBe(false)
    expect(checkDue({ enabled: false, noticeAt: 1, runStartedAt: 5, now: 9 })).toBe(false)
  })
  const mount = async (versions: string[], answer: boolean) => {
    const calls: string[] = []; const asked: ConfirmOptions[] = []; let i = 0
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = { invoke: async (c: string, a: { version?: string }) => {
      calls.push(c + (a?.version ? ` ${a.version}` : ''))
      return c === 'update_configured' ? true : c === 'update_check' ? { current: '1.0.0', version: versions[Math.min(i++, versions.length - 1)], notes: null, date: null } : null } }
    localStorage.setItem('test.updateState', JSON.stringify({ noticeAt: 1, noticeAnswered: true }))
    let u!: ReturnType<typeof useUpdates>; const confirm = async (o: ConfirmOptions) => { asked.push(o); return answer }; const notify = () => {}; const set = () => {}
    function Host() { u = useUpdates(true, set, notify, confirm); return null }
    render(<Host />); await waitFor(() => expect(u.available?.version).toBe(versions[0]))
    return { calls, asked, go: () => act(async () => { await u.install() }) }
  }
  it('installs only after a yes', async () => {
    const no = await mount(['1.1.0'], false); await no.go(); expect(no.calls.some((c) => c.startsWith('update_install'))).toBe(false)
  })
  it('asks again when the newest version changed meanwhile', async () => {
    const t = await mount(['1.1.0', '1.2.0'], true); await t.go(); expect(t.asked).toHaveLength(2); expect(t.calls).toContain('update_install 1.2.0'); expect(t.calls).not.toContain('update_install 1.1.0')
  })
})
