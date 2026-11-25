// Demo shop: a small page + JSON API. BUG=<id> plants one of 20 bugs (see bugs.json).
import { createServer } from 'node:http'
const bug = process.env.BUG ?? ''
const is = (id) => bug === id
const products = [{ id: 1, name: 'Mug', price: 12, stock: 5 }, { id: 2, name: 'Lamp', price: 40, stock: 2 }, { id: 3, name: 'Chair', price: 90, stock: 0 }]
let cart = []
const page = `<!doctype html><html lang="en"><head><title>Demo shop</title></head><body>
<h1>Demo shop</h1><p id="status" role="status"></p>
<form id="login" aria-label="Sign in"><label>Email <input name="email"></label><label>Password <input name="password" type="password"></label><button>Sign in</button></form>
<label>Search <input id="q"></label>
<ul id="list" aria-label="Products"></ul>
<section aria-label="Cart"><h2>Cart</h2><ul id="cart"></ul><p>Total: <b data-testid="total"></b></p>
<label>Coupon <input id="coupon"></label><button id="apply">Apply coupon</button>
<button id="order">Place order</button></section>
<script>
const B=${JSON.stringify(bug)}, $=(s)=>document.querySelector(s); let products=[], discount=0
const say=(t)=>{ $('#status').textContent=t }
const api=async(p,o)=>{ const r=await fetch('/api'+p,o); if(!r.ok) throw Error((await r.json().catch(()=>({}))).error||'Something went wrong'); return r.json() }
const post=(p,b)=>api(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})})
function draw(){ const q=$('#q').value.toLowerCase(); $('#list').innerHTML=''
 for(const p of products){ if(B!=='search-ignored'&&!p.name.toLowerCase().includes(q)) continue
  const li=document.createElement('li'); li.innerHTML='<span>'+p.name+' $'+p.price+'</span> '; const b=document.createElement('button'); b.textContent='Add '+p.name; b.disabled=B!=='stock-ignored'&&p.stock===0
  b.onclick=async()=>{ if(B==='add-dead')return; try{ cartDraw(await post('/cart',{id:B==='wrong-item'?(p.id%2)+1:p.id})); if(B!=='no-add-message')say(p.name+' added') }catch(e){ say(e.message) } }; li.append(b); $('#list').append(li) } }
function cartDraw(c){ $('#cart').innerHTML=c.map(i=>'<li>'+(B==='qty-hidden'?i.name:i.name+' x'+i.qty)+' <button data-id="'+i.id+'">Remove '+i.name+'</button></li>').join('')
 const t=c.reduce((s,i)=>s+i.price*(B==='total-qty'?1:i.qty),0); $('[data-testid=total]').textContent='$'+(B==='total-zero'?0:t*(1-discount))
 document.querySelectorAll('#cart button').forEach(b=>b.onclick=async()=>{ if(B==='remove-dead')return; cartDraw(await post('/remove',{id:+b.dataset.id})) }) }
$('#q').oninput=draw
$('#login').onsubmit=async(e)=>{ e.preventDefault(); const f=new FormData(e.target); try{ const u=await post('/login',{email:f.get('email'),password:f.get('password')}); say(B==='wrong-name'?'Welcome guest':'Welcome '+u.name) }catch(e){ if(B!=='login-error-hidden') say(e.message) } }
$('#apply').onclick=async()=>{ if(B==='coupon-dead')return; try{ const c=await post('/coupon',{code:$('#coupon').value}); discount=B==='coupon-no-discount'?0:c.percent/100; cartDraw(await api('/cart')); say('Coupon applied') }catch(e){ say(e.message) } }
$('#order').onclick=async()=>{ try{ const o=await post('/order'); cartDraw(B==='cart-not-cleared'?await api('/cart?old'):[]); say(B==='order-no-id'?'Order placed':'Order '+o.id+' placed') }catch(e){ say(B==='order-false-success'?'Order 1001 placed':e.message) } }
api('/products').then(p=>{ products=B==='missing-product'?p.slice(1):p; draw() }).catch(e=>say(e.message)); api('/cart').then(cartDraw)
</script></body></html>`
createServer(async (q, r) => {
  let raw = ''; for await (const c of q) raw += c
  const body = raw ? JSON.parse(raw) : {}
  const send = (s, d) => { r.writeHead(s, { 'content-type': 'application/json' }); r.end(JSON.stringify(d)) }
  const u = new URL(q.url, 'http://x').pathname
  if (u === '/') { r.writeHead(200, { 'content-type': 'text/html' }); return r.end(page) }
  if (u === '/api/reset') { cart = []; return send(200, {}) }
  if (u === '/api/products') return send(200, products.map((p) => (is('price-wrong') && p.id === 1 ? { ...p, price: 13 } : p)))
  if (u === '/api/cart' && q.method === 'GET') return send(200, cart)
  if (u === '/api/cart') { const p = products.find((x) => x.id === body.id); const i = cart.find((x) => x.id === p.id); if (i) i.qty += is('qty-stuck') ? 0 : 1; else cart.push({ ...p, qty: 1 }); return send(200, cart) }
  if (u === '/api/remove') { cart = cart.filter((x) => x.id !== body.id); return send(200, cart) }
  if (u === '/api/login') return body.password === 'secret' || is('any-password') ? send(200, { name: 'Asha' }) : send(401, { error: 'Wrong email or password' })
  if (u === '/api/coupon') return body.code === 'SAVE10' || is('any-coupon') ? send(200, { percent: 10 }) : send(400, { error: 'Unknown coupon' })
  if (u === '/api/order') { if (!cart.length && !is('empty-order')) return send(400, { error: 'Your cart is empty' }); const old = cart; cart = is('cart-not-cleared') ? old : []; return is('order-fails') ? send(500, { error: 'Order failed' }) : send(200, { id: 1001 }) }
  send(404, { error: 'Not found' })
}).listen(+(process.env.PORT ?? 4173), '127.0.0.1')
