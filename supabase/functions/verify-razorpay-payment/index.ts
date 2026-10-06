// Called by the browser after Razorpay Checkout reports success. Never trusts the browser:
// the signature is verified here with the key secret, the payment is bound to the caller's own
// order, and the state change is applied by an idempotent SQL function.
import { HttpError, json, readJson, requireUser, serviceClient, toResponse, corsHeaders } from '../_shared/http.ts'
import { isHexSignature, isRazorpayOrderId, isRazorpayPaymentId, verifyCheckoutSignature } from '../_shared/razorpay.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed.')
    const keySecret = Deno.env.get('RAZORPAY_KEY_SECRET')
    if (!keySecret) { console.error('[verify-razorpay-payment] RAZORPAY_KEY_SECRET missing'); throw new HttpError(503, 'Online payments are temporarily unavailable.') }

    const user = await requireUser(req)
    const body = await readJson(req)
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body
    if (!isRazorpayOrderId(razorpay_order_id) || !isRazorpayPaymentId(razorpay_payment_id) || !isHexSignature(razorpay_signature)) {
      throw new HttpError(400, 'Invalid payment details.')
    }

    if (!(await verifyCheckoutSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature, keySecret))) {
      // A bad signature must never be able to fail someone's order, so nothing is written.
      console.warn('[verify-razorpay-payment] invalid signature', { user: user.id, razorpay_order_id })
      throw new HttpError(400, 'We could not verify this payment.')
    }

    const db = serviceClient()
    const applied = await db.rpc('crave_payment_apply', {
      p_razorpay_order_id: razorpay_order_id, p_razorpay_payment_id: razorpay_payment_id, p_status: 'PAID',
      p_amount_paise: null, p_signature: razorpay_signature, p_expected_user: user.id,
    })
    if (applied.error) throw applied.error
    const r = applied.data as { order_id: string; order_status: string; payment_status: string }
    return json(req, { success: r.payment_status === 'PAID', order_id: r.order_id, order_status: r.order_status, payment_status: r.payment_status })
  } catch (err) { return toResponse(req, err, 'verify-razorpay-payment') }
})
