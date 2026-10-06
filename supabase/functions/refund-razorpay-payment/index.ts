// Management-only: refund a captured payment whose order was cancelled / rejected / expired.
import { HttpError, json, readJson, requireUser, serviceClient, toResponse, corsHeaders } from '../_shared/http.ts'
import { isUuid } from '../_shared/razorpay.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')
    const keyId = Deno.env.get('RAZORPAY_KEY_ID'), keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')
    if (!keyId || !keySecret) throw new HttpError(503, 'Refunds are temporarily unavailable.')

    const user = await requireUser(req)
    const db = serviceClient()
    const { data: profile } = await db.from('profiles').select('role, is_active').eq('id', user.id).maybeSingle()
    if (!profile || profile.role !== 'ADMIN' || !profile.is_active) throw new HttpError(403, 'Management access required.')

    const { order_id } = await readJson(req)
    if (!isUuid(order_id)) throw new HttpError(400, 'Invalid order.')

    const { data: row, error } = await db.from('payments')
      .select('amount, status, razorpay_payment_id, gateway_provider, orders!inner(status)').eq('order_id', order_id).single()
    if (error || !row) throw new HttpError(404, 'Payment not found.')
    const orderStatus = (row as any).orders?.status
    if (!['PAID', 'CAPTURED'].includes(row.status) || row.gateway_provider !== 'RAZORPAY' || !row.razorpay_payment_id) throw new HttpError(409, 'This payment cannot be refunded.')
    if (!['CANCELLED', 'REJECTED', 'EXPIRED'].includes(orderStatus)) throw new HttpError(409, 'Only cancelled or rejected orders can be refunded.')

    const res = await fetch(`https://api.razorpay.com/v1/payments/${row.razorpay_payment_id}/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}` },
      body: JSON.stringify({ amount: Math.round(Number(row.amount) * 100), speed: 'normal', notes: { crave_order_id: order_id, refunded_by: user.id } }),
      signal: AbortSignal.timeout(20000),
    })
    const refund = await res.json().catch(() => ({}))
    const alreadyRefunded = !res.ok && /already been fully refunded/i.test(String(refund?.error?.description ?? ''))
    if (!res.ok && !alreadyRefunded) { console.error('[refund-razorpay-payment] Razorpay error', res.status, JSON.stringify(refund)); throw new HttpError(502, 'Razorpay could not process the refund. Please try again.') }

    const marked = await db.rpc('crave_payment_mark_refunded', { p_order_id: order_id, p_refund_id: refund?.id ?? 'already_refunded' })
    if (marked.error) throw marked.error
    return json(req, { success: true, refund_id: refund?.id ?? null })
  } catch (err) { return toResponse(req, err, 'refund-razorpay-payment') }
})
