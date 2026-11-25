const token = location.hash.slice(1) || sessionStorage.getItem('breakwright') || ''
if (location.hash.length > 1) { sessionStorage.setItem('breakwright', token); history.replaceState(null, '', location.pathname) }
const opts = (b: object, signal?: AbortSignal): RequestInit => ({ method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(b), signal })
export async function api<T = any>(name: string, b: object = {}): Promise<T> {
  let r: Response
  try { r = await fetch(`/api/${name}`, opts(b)) } catch { throw new Error('Breakwright has stopped. Start it again.') }
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? 'That didn’t work.'); return j
}
export async function stream(name: string, b: object, on: (e: any) => void, signal: AbortSignal) {
  const r = await fetch(`/api/${name}`, opts(b, signal)); if (!r.body || !r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'That didn’t work.')
  const rd = r.body.pipeThrough(new TextDecoderStream()).getReader(); let buf = ''
  for (;;) { const { done, value } = await rd.read(); if (done) break; buf += value; let i; while ((i = buf.indexOf('\n')) >= 0) { const e = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); if (e.t === 'error') throw new Error(e.message); on(e) } }
}
export async function image(rel: string) { const r = await fetch(`/api/file?rel=${encodeURIComponent(rel)}`, { headers: { authorization: `Bearer ${token}` } }); return r.ok ? URL.createObjectURL(await r.blob()) : null }
