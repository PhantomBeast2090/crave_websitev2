#!/usr/bin/env node
// Live attack regression: every check here is an exploit that WORKED before migrations 018-021.
// Usage (credentials come from the environment, never from source control):
//   CRAVE_STUDENT_EMAIL=… CRAVE_VENDOR_EMAIL=… CRAVE_ADMIN_EMAIL=… CRAVE_TEST_PASSWORD=… node scripts/redteam-live.mjs
// Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from .env. All checks are expected to be BLOCKED, so nothing is mutated.
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
const URL_ = env.VITE_SUPABASE_URL.replace(/\/rest\/v1\/?$/, ''), KEY = env.VITE_SUPABASE_ANON_KEY
const need = ['CRAVE_STUDENT_EMAIL', 'CRAVE_VENDOR_EMAIL', 'CRAVE_ADMIN_EMAIL', 'CRAVE_TEST_PASSWORD']
if (need.some((n) => !process.env[n])) { console.error(`Set ${need.join(', ')}`); process.exit(2) }

const call = async (method, path, token, body, extra = {}) => {
  const res = await fetch(URL_ + path, { method, headers: { apikey: KEY, Authorization: `Bearer ${token ?? KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await res.text(); let data; try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { code: res.status, data }
}
const login = async (email) => { const r = await call('POST', '/auth/v1/token?grant_type=password', null, { email, password: process.env.CRAVE_TEST_PASSWORD }); if (!r.data?.access_token) throw new Error(`login failed for ${email}`); return { token: r.data.access_token, id: r.data.user.id } }
const T = { student: await login(process.env.CRAVE_STUDENT_EMAIL), vendor: await login(process.env.CRAVE_VENDOR_EMAIL), admin: await login(process.env.CRAVE_ADMIN_EMAIL) }
const get = (who, path) => call('GET', '/rest/v1/' + path, who && T[who].token)
const patch = (who, path, body) => call('PATCH', '/rest/v1/' + path, who && T[who].token, body)
const post = (who, path, body) => call('POST', '/rest/v1/' + path, who && T[who].token, body)
const rpc = (who, fn, args = {}) => call('POST', '/rest/v1/rpc/' + fn, who && T[who].token, args)
const Z = '00000000-0000-0000-0000-000000000000'

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  <-- ${String(detail).slice(0, 200)}`}`) }
const denied = (r) => r.code === 401 || r.code === 403 || (r.data && typeof r.data === 'object' && /permission denied|row-level security|not authorized|cannot change|Protected order|Illegal order|ADMIN|Only |not found|42501/i.test(JSON.stringify(r.data)))
const emptyOrDenied = (r) => denied(r) || (Array.isArray(r.data) && r.data.length === 0)

console.log('== Anonymous internet')
check('anon cannot call mark_payment_verified (was: HTTP 204 = executed)', denied(await rpc(null, 'mark_payment_verified', { p_order_id: Z, p_razorpay_payment_id: 'x', p_razorpay_signature: 'x', p_status: 'PAID' })), 'executed')
check('anon cannot call crave_payment_apply', denied(await rpc(null, 'crave_payment_apply', { p_razorpay_order_id: 'order_x', p_razorpay_payment_id: 'pay_x', p_status: 'PAID' })))
check('anon cannot call place_order', denied(await rpc(null, 'place_order', { p_cart_id: Z, p_pickup_slot_id: Z, p_payment_method: 'ONLINE' })))
check('anon cannot call get_food_reviews (leaked reviewer names/ids)', denied(await rpc(null, 'get_food_reviews', { p_food_item_id: Z })))
check('anon cannot call get_management_dashboard', denied(await rpc(null, 'get_management_dashboard', {})))
check('anon cannot call generate_pickup_slots', denied(await rpc(null, 'generate_pickup_slots', {})))
for (const t of ['orders', 'payments', 'profiles', 'order_items', 'pickup_tokens', 'payment_events', 'audit_logs']) check(`anon reads nothing from ${t}`, emptyOrDenied(await get(null, `${t}?select=*&limit=5`)))

console.log('\n== Student attacks')
const ownProfile = (await get('student', 'profiles?select=id,role')).data
check('student sees exactly one profile (their own)', Array.isArray(ownProfile) && ownProfile.length === 1 && ownProfile[0].id === T.student.id, JSON.stringify(ownProfile))
const myRole = ownProfile?.[0]?.role
check('account is STUDENT (sanity)', myRole === 'STUDENT', myRole)
for (const role of ['VENDOR', 'ADMIN']) {
  const r = await patch('student', `profiles?id=eq.${T.student.id}`, { role }); check(`student cannot set own role=${role} (was: 200 OK, escalated)`, denied(r), JSON.stringify(r.data))
}
check('role unchanged after attempts', (await get('student', 'profiles?select=role')).data?.[0]?.role === 'STUDENT')
check('student cannot disable/enable own is_active', denied(await patch('student', `profiles?id=eq.${T.student.id}`, { is_active: false })))
const orders = (await get('student', 'orders?select=id,status,payment_status,total&status=in.(CREATED,PLACED)&order=created_at.desc&limit=1')).data
if (orders?.length) {
  const o = orders[0]
  check('student cannot set own order payment_status=PAID (was: 200 OK)', denied(await patch('student', `orders?id=eq.${o.id}`, { payment_status: 'PAID' })))
  check('student cannot lower own order total', denied(await patch('student', `orders?id=eq.${o.id}`, { total: 1 })))
  check('student cannot jump order to PICKED_UP', denied(await patch('student', `orders?id=eq.${o.id}`, { status: 'PICKED_UP' })))
  check('student cannot move order to another user', denied(await patch('student', `orders?id=eq.${o.id}`, { user_id: T.vendor.id })))
  check('order unchanged afterwards', JSON.stringify((await get('student', `orders?id=eq.${o.id}&select=status,payment_status,total`)).data[0]) === JSON.stringify({ status: o.status, payment_status: o.payment_status, total: o.total }))
  check('student cannot insert fake order_items on own order (was allowed)', denied(await post('student', 'order_items', { order_id: o.id, food_item_id: Z, food_name: 'x', quantity: 1, unit_price: 0, total_price: 0, is_veg: true })))
} else console.log('SKIP  order-tampering checks need an order in CREATED/PLACED state (none right now; the DB-level suite covers them: pnpm test:db)')
check('student cannot insert an order directly', denied(await post('student', 'orders', { user_id: T.student.id, order_number: 'X', subtotal: 0, tax: 0, total: 0 })))
check('student cannot insert payments', denied(await post('student', 'payments', { order_id: Z, amount: 0 })))
check('student cannot call mark_payment_verified', denied(await rpc('student', 'mark_payment_verified', { p_order_id: Z, p_razorpay_payment_id: 'x', p_razorpay_signature: 'x', p_status: 'PAID' })))
for (const fn of ['get_management_dashboard', 'get_vendor_dashboard', 'admin_refund_candidates', 'get_management_reviews']) check(`student cannot call ${fn}`, denied(await rpc('student', fn, {})))
check('student cannot set another user role via RPC', denied(await rpc('student', 'admin_set_user_role', { p_user_id: T.vendor.id, p_role: 'STUDENT' })))
check('student cannot accept someone else\'s order (vendor RPC)', denied(await rpc('student', 'vendor_accept_order', { p_order_id: Z })))
check('student cannot verify pickup tokens', denied(await rpc('student', 'verify_pickup_token', { p_token: 'x' })))
check('student cannot edit catalogue price (RLS: 0 rows)', emptyOrDenied(await patch('student', `food_items?id=eq.${Z}`, { price: 1 })))
check('student cannot edit outlet', emptyOrDenied(await patch('student', `outlets?id=eq.${Z}`, { is_open: false })))
check('student cannot edit inventory', emptyOrDenied(await patch('student', `inventory?food_item_id=eq.${Z}`, { quantity_available: 999 })))
check('student cannot read payment_events', emptyOrDenied(await get('student', 'payment_events?select=*')))
check('student cannot read audit_logs', emptyOrDenied(await get('student', 'audit_logs?select=*&limit=3')))

console.log('\n== Vendor attacks')
const vProfiles = (await get('vendor', 'profiles?select=id,role,email')).data
check('vendor no longer reads every profile (was: all 5 incl. admin)', Array.isArray(vProfiles) && vProfiles.every((p) => p.id === T.vendor.id || p.role === 'STUDENT'), JSON.stringify(vProfiles?.map((p) => p.role)))
check('vendor cannot see the admin profile', !vProfiles?.some((p) => p.id === T.admin.id))
check('vendor cannot self-promote to ADMIN', denied(await patch('vendor', `profiles?id=eq.${T.vendor.id}`, { role: 'ADMIN' })))
const outlet = (await get('vendor', 'outlets?select=id,rating&limit=1')).data?.[0]
if (outlet) {
  check('vendor cannot forge outlet rating', denied(await patch('vendor', `outlets?id=eq.${outlet.id}`, { rating: 5 })))
  check('vendor cannot transfer outlet ownership', denied(await patch('vendor', `outlets?id=eq.${outlet.id}`, { vendor_id: T.admin.id })))
}
const food = (await get('vendor', 'food_items?select=id&limit=1')).data?.[0]
if (food) check('vendor cannot forge food rating', denied(await patch('vendor', `food_items?id=eq.${food.id}`, { rating: 5, total_reviews: 999 })))
for (const fn of ['get_management_dashboard', 'admin_refund_candidates']) check(`vendor cannot call ${fn}`, denied(await rpc('vendor', fn, {})))
check('vendor cannot place orders', denied(await rpc('vendor', 'place_order', { p_cart_id: Z, p_pickup_slot_id: Z, p_payment_method: 'PAY_AT_COUNTER' })))
check('vendor cannot mark payment verified', denied(await rpc('vendor', 'mark_payment_verified', { p_order_id: Z, p_razorpay_payment_id: 'x', p_razorpay_signature: 'x', p_status: 'PAID' })))
check('vendor cannot read admin-only payment events', emptyOrDenied(await get('vendor', 'payment_events?select=*')))

console.log('\n== Management')
const dash = await rpc('admin', 'get_management_dashboard', { p_days: 7 })
check('management dashboard works', dash.code === 200 && Array.isArray(dash.data?.trend) && dash.data.trend.length === 7, JSON.stringify(dash.data).slice(0, 120))
check('management cannot change own role', denied(await rpc('admin', 'admin_set_user_role', { p_user_id: T.admin.id, p_role: 'STUDENT' })))
check('management cannot disable self', denied(await rpc('admin', 'admin_set_user_active', { p_user_id: T.admin.id, p_active: false })))
check('management cannot call mark_payment_verified (service-only)', denied(await rpc('admin', 'mark_payment_verified', { p_order_id: Z, p_razorpay_payment_id: 'x', p_razorpay_signature: 'x', p_status: 'PAID' })))
const adminOrders = (await get('admin', 'orders?select=id,status&limit=1')).data
check('management can read orders', Array.isArray(adminOrders))

console.log('\n== Edge functions (payment endpoints)')
const fn = (name, who, body, headers = {}) => call('POST', `/functions/v1/${name}`, who && T[who].token, body, headers)
check('create-razorpay-order rejects anonymous caller', [401, 403].includes((await fn('create-razorpay-order', null, { order_id: Z })).code))
check('create-razorpay-order rejects invalid order id', (await fn('create-razorpay-order', 'student', { order_id: 'nope' })).code === 400)
check('create-razorpay-order: someone else\'s / unknown order -> 404', (await fn('create-razorpay-order', 'student', { order_id: Z })).code === 404)
check('create-razorpay-order never trusts a client amount (ignored)', [400, 404].includes((await fn('create-razorpay-order', 'student', { order_id: Z, amount: 1 })).code))
const fake = (await fn('verify-razorpay-payment', 'student', { razorpay_order_id: 'order_FAKEFAKE123', razorpay_payment_id: 'pay_FAKEFAKE123', razorpay_signature: 'a'.repeat(64) }))
check('fake Razorpay signature rejected', fake.code === 400, `${fake.code} ${JSON.stringify(fake.data)}`)
check('malformed verification payload rejected', (await fn('verify-razorpay-payment', 'student', { razorpay_order_id: 'x' })).code === 400)
check('verify rejects anonymous caller', [401, 403].includes((await fn('verify-razorpay-payment', null, { razorpay_order_id: 'order_FAKEFAKE123', razorpay_payment_id: 'pay_FAKEFAKE123', razorpay_signature: 'a'.repeat(64) })).code))
const hook = await fn('razorpay-webhook', null, { event: 'payment.captured' }, { 'x-razorpay-signature': 'f'.repeat(64) })
check('webhook rejects a forged signature (401) or is not configured (503) — never accepts', [401, 503].includes(hook.code), `${hook.code}`)
check('webhook without signature never accepts', [401, 503].includes((await fn('razorpay-webhook', null, { event: 'payment.captured' })).code))
check('refund endpoint refuses students', (await fn('refund-razorpay-payment', 'student', { order_id: Z })).code === 403)
check('refund endpoint refuses vendors', (await fn('refund-razorpay-payment', 'vendor', { order_id: Z })).code === 403)

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
