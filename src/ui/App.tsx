import { useCallback, useEffect, useState } from 'react'
import { AboutDialog, type Section, Shell, ThemePicker, useMenuDismiss, useTheme, useToast } from '../../kit/ui'
import { api } from './api'
import { Chat } from './Chat'
import { Proposals, Runs, SignIn, Connect } from './Pages'
import { Tests } from './Tests'

export type Fail = (e: Error) => void
export function App() {
  const [st, setSt] = useState<any>(null), [page, setPage] = useState('tests'), [err, setErr] = useState(''), [chat, setChat] = useState(false), [open, setOpen] = useState(0), [run, setRun] = useState<string | null>(null)
  const [about, setAbout] = useState(false), [lib, setLib] = useState<HTMLElement | null>(null), { theme, setTheme } = useTheme(), note = useToast()
  useMenuDismiss()
  const fail = useCallback<Fail>((e) => setErr(e.message), [])
  useEffect(() => { api('state').then(setSt, fail) }, [fail])
  useEffect(() => { if (!st?.project) return; const f = () => api('proposals').then((x) => setOpen(x.filter((p: any) => p.state === 'open').length), () => {}); f(); const t = setInterval(f, 8000); return () => clearInterval(t) }, [st?.project?.root, page])
  const toast = err && <div className="alert" role="alert"><span>{err}</span><button onClick={() => setErr('')}>Dismiss</button></div>
  if (!st) return <>{toast}<main className="home"><p>{err ? 'Open Breakwright from its own window, or with the link it printed.' : 'Opening…'}</p></main></>
  if (!st.project) return <>{toast}<Home st={st} set={setSt} fail={fail} /></>
  const p = st.project
  if (p.problem) return <main className="home stack">{toast}<h1>This folder isn’t ready</h1><p>{p.problem}</p><p className="mono">{p.root}</p><div className="row"><button className="main" onClick={() => api('open', { dir: p.root }).then(setSt, fail)}>Check again</button><button onClick={() => setSt({ ...st, project: null })}>Open another folder</button></div></main>
  const sections: Section[] = [{ id: 'tests', label: 'Tests', icon: 'collections', library: <div ref={setLib} /> }, { id: 'runs', label: 'Runs', icon: 'runner' }, { id: 'proposals', label: `Proposals${open ? ` (${open})` : ''}`, icon: 'share' }, { id: 'signin', label: 'Sign-in', iconPath: 'M12 3a5 5 0 0 1 5 5v3H7V8a5 5 0 0 1 5-5zM5 11h14v10H5zM12 15v2' }, { id: 'connect', label: 'AI access', icon: 'settings' }]
  return <><Shell sections={sections} active={page} onPick={setPage} onBrand={() => setPage('tests')}
    top={<><span className="proj k-ellipsis" title={p.root}>{p.root.split(/[\\/]/).pop()}</span><button className="k-btn small ghost" onClick={() => setSt({ ...st, project: null })}>Switch</button><span className="k-grow" /><button className={`k-btn small ${chat ? '' : 'ghost'}`} aria-pressed={chat} onClick={() => setChat(!chat)}>Assistant</button>
      <details className="k-menu"><summary aria-label="Menu">☰</summary><div className="k-menuList"><div className="pick"><span className="k-muted">Theme</span><ThemePicker theme={theme} setTheme={setTheme} /></div><button onClick={(e) => { e.currentTarget.closest('details')!.open = false; setAbout(true) }}>About Breakwright</button></div></details></>}
    status={<span className="k-ellipsis">{p.root}</span>}
    work={<div className={`body${chat ? ' chat' : ''}`}>
      {page === 'tests' && <Tests key={p.root} lib={lib} st={st} setSt={setSt} fail={fail} showRun={(id) => { setRun(id); setPage('runs') }} />}
      {page === 'runs' && <Runs fail={fail} id={run} pick={setRun} st={st} />}
      {page === 'proposals' && <Proposals fail={fail} st={st} />}
      {page === 'signin' && <SignIn fail={fail} st={st} />}
      {page === 'connect' && <Connect fail={fail} st={st} setSt={setSt} />}
      {chat && <Chat st={st} setSt={setSt} fail={fail} close={() => setChat(false)} goConnect={() => { setPage('connect'); if (innerWidth < 820) setChat(false) }} />}
    </div>} />
    {about && <AboutDialog onClose={() => setAbout(false)} notify={note.notify} />}{note.node}{toast}</>
}
function Home({ st, set, fail }: { st: any; set: (s: any) => void; fail: Fail }) {
  const [f, setF] = useState<any>(null), [dir, setDir] = useState('')
  const go = (d: string) => api('open', { dir: d }).then(set, fail), look = (d?: string) => api('folders', { dir: d }).then(setF, fail)
  return <main className="home stack" style={{ gap: 24 }}>
    <div className="stack"><h1>Know that your browser tests really test something</h1><p>Open a Playwright project. Breakwright breaks your app on purpose, one thing at a time, and shows which breakages your tests miss. Your tests stay ordinary files in your own folder.</p></div>
    <form className="row" onSubmit={(e) => { e.preventDefault(); if (dir) go(dir) }}><input className="grow" aria-label="Project folder" placeholder="Path to a project folder" value={dir} onChange={(e) => setDir(e.target.value)} /><button className="main">Open folder</button><button type="button" onClick={() => look()}>Browse</button></form>
    {f && <section className="stack"><div className="row"><button onClick={() => look(f.parent)}>Up one folder</button><span className="mono grow">{f.dir}</span><button onClick={() => go(f.dir)}>Open this one</button></div><div className="list">{f.list.map((x: any) => <button key={x.path} className="plain" onClick={() => (x.project ? go(x.path) : look(x.path))}>{x.name}{x.project && <b> (Playwright project)</b>}</button>)}</div></section>}
    {st.recent.length > 0 && <section className="stack"><h3>Recent</h3><div className="list">{st.recent.map((r: string) => <button key={r} className="plain mono" onClick={() => go(r)}>{r}</button>)}</div></section>}
  </main>
}
