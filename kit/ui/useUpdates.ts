/** Checks for a new version when allowed, remembers what was dismissed, installs only on a yes. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { app, device, errorText, isDesktop, native, openExternal } from './app'
import type { ConfirmOptions } from './Dialogs'
import type { Notify } from './Toast'
import { checkDue, DAY, type UpdateState } from './updateSchedule'

export interface UpdateInfo { current: string; version: string | null; notes: string | null; date: string | null }
const TICK = 15 * 60_000, RETRY = 3_600_000
const check = () => native<UpdateInfo>('update_check')
const question = (i: UpdateInfo): ConfirmOptions => ({
  message: `Install ${app().name} ${i.version}? You have ${i.current}. ${app().name} restarts when it’s done.${i.notes?.trim() ? `\n\n${i.notes.trim().slice(0, 600)}` : ''}`,
  ok: 'Install and restart',
})
export type Updates = ReturnType<typeof useUpdates>
export function useUpdates(enabled: boolean, setEnabled: (on: boolean) => void, notify: Notify, confirm: (o: ConfirmOptions) => Promise<boolean>) {
  const [configured, setConfigured] = useState(false)
  const [saved, setSaved] = useState<UpdateState>(() => device.get('updateState', {}))
  const savedRef = useRef(saved)
  const [found, setFound] = useState<UpdateInfo | null>(null)
  const [busy, setBusyState] = useState(false)
  const busyRef = useRef(false), checking = useRef(false), started = useRef(Date.now()), last = useRef<number | undefined>(undefined)
  const on = useRef(enabled); on.current = enabled
  const setBusy = (b: boolean) => { busyRef.current = b; setBusyState(b) }
  const save = useCallback((patch: Partial<UpdateState>) => { savedRef.current = { ...savedRef.current, ...patch }; setSaved(savedRef.current); device.set('updateState', savedRef.current) }, [])
  useEffect(() => { if (isDesktop()) native<boolean>('update_configured').then(setConfigured, () => { /* no checks in this run */ }) }, [])
  const noticeOpen = configured && enabled && !saved.noticeAnswered
  useEffect(() => { if (noticeOpen && savedRef.current.noticeAt === undefined) save({ noticeAt: Date.now() }) }, [noticeOpen, save])
  const tick = useCallback(async () => {
    const now = Date.now()
    if (checking.current || busyRef.current || !checkDue({ enabled: on.current, noticeAt: savedRef.current.noticeAt, runStartedAt: started.current, lastCheckAt: last.current, now })) return
    checking.current = true; last.current = now
    try { const i = await check(); if (on.current && !busyRef.current) setFound(i.version ? i : null) }
    catch { last.current = now - DAY + RETRY /* an automatic check says nothing */ } finally { checking.current = false }
  }, [])
  useEffect(() => {
    if (!configured || !enabled) return
    void tick(); const t = setInterval(() => void tick(), TICK); return () => clearInterval(t)
  }, [configured, enabled, tick])
  /** Always checks again first: a failed install uses up the update found before. */
  const run = useCallback(async (asked: UpdateInfo | null) => {
    if (busyRef.current) { notify('An update check or install is already running.'); return }
    setBusy(true)
    try {
      if (asked && !(await confirm(question(asked)))) return
      const i = await check(); last.current = Date.now()
      if (!i.version) { setFound(null); notify(`You have the newest version (${i.current}).`); return }
      setFound(i); if (savedRef.current.dismissed) save({ dismissed: undefined })
      if (i.version !== asked?.version && !(await confirm(question(i)))) return
      notify(`Downloading ${app().name} ${i.version}…`)
      await native('update_install', { version: i.version })
    } catch (e) { notify(errorText(e), { label: 'Open download page', run: () => void openExternal(`${app().site}/download/`) }) } finally { setBusy(false) }
  }, [confirm, notify, save])
  return {
    configured, busy, noticeOpen, available: found && found.version !== saved.dismissed ? found : null,
    answerNotice: (keep: boolean) => { save({ noticeAnswered: true }); if (!keep) setEnabled(false) },
    dismiss: () => { if (found?.version) save({ dismissed: found.version }) },
    install: () => run(found), checkNow: () => run(null),
  }
}
