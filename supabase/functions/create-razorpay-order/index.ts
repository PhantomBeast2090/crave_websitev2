// Creates (or re-uses) the Razorpay order for one of the caller's unpaid ONLINE orders.
// The amount ALWAYS comes from the database (payments.amount); the client never sends one.
import { HttpError, json, readJson, requireUser, serviceClient, toResponse, corsHeaders } from '../_shared/http.ts'
import { isUuid } from '../_shared/razorpay.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')
    const keyId = Deno.env.get('RAZORPAY_KEY_ID'), keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')
    if (!keyId || !keySecret) { console.error('[create-razorpay-order] Razorpay keys are not configured'); throw new HttpError(503, 'Online payments are temporarily unavailable.') }

    const user = await requireUser(req)
    const { order_id } = await readJson(req)
    if (!isUuid(order_id)) throw new HttpError(400, 'Invalid order.')

    const db = serviceClient()
    const prep = await db.rpc('crave_payment_prepare', { p_order_id: order_id, p_user_id: user.id })
    if (prep.error) throw prep.error
    const { amount_paise, razorpay_order_id: existing, expires_at } = prep.data as { amount_paise: number; razorpay_order_id: string | null; expires_at: string | null }

    let razorpayOrderId = existing
    if (!razorpayOrderId) {
      const res = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}` },
        body: JSON.stringify({ amount: amount_paise, currency: 'INR', receipt: String(order_id).slice(0, 40), notes: { crave_order_id: order_id, crave_user_id: user.id } }),
        signal: AbortSignal.timeout(15000),
      })
      const created = await res.json().catch(() => ({}))
      if (!res.ok || !created?.id) { console.error('[create-razorpay-order] Razorpay rejected order creation', res.status, JSON.stringify(created)); throw new HttpError(502, 'We could not start the payment. Please try again.') }
      // Compare-and-set: if a parallel request won, we use ITS Razorpay order (the extra one is never paid).
      const attached = await db.rpc('crave_payment_attach', { p_order_id: order_id, p_razorpay_order_id: created.id })
      if (attached.error) throw attached.error
      razorpayOrderId = attached.data as string
    }

    return json(req, { order_id, razorpay_order_id: razorpayOrderId, amount: amount_paise, currency: 'INR', key_id: keyId, expires_at })
  } catch (err) { return toResponse(req, err, 'create-razorpay-order') }
})
