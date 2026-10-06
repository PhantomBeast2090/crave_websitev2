// Razorpay -> Crave asynchronous confirmation. Deployed with verify_jwt = false (Razorpay does not
// send a Supabase JWT); authenticity comes from the HMAC over the raw body. Idempotent: duplicates,
// retries and "webhook before browser verification" are all safe.
import { serviceClient } from '../_shared/http.ts'
import { decideWebhookAction, verifyWebhookSignature } from '../_shared/razorpay.ts'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const secret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET')
  if (!secret) { console.error('[razorpay-webhook] RAZORPAY_WEBHOOK_SECRET is not set'); return new Response('Not configured', { status: 503 }) }

  const rawBody = await req.text()
  if (!(await verifyWebhookSignature(rawBody, req.headers.get('x-razorpay-signature'), secret))) {
    console.warn('[razorpay-webhook] rejected: bad signature')
    return new Response('Invalid signature', { status: 401 })
  }

  let payload: any
  try { payload = JSON.parse(rawBody) } catch { return new Response('Bad payload', { status: 400 }) }

  const eventId = req.headers.get('x-razorpay-event-id') ?? `${payload?.event}:${payload?.payload?.payment?.entity?.id ?? payload?.created_at}`
  const db = serviceClient()
  try {
    const decision = decideWebhookAction(payload)
    if (decision.kind !== 'ignore') {
      const applied = await db.rpc('crave_payment_apply', {
        p_razorpay_order_id: decision.razorpayOrderId, p_razorpay_payment_id: decision.razorpayPaymentId,
        p_status: decision.kind.toUpperCase(), p_amount_paise: decision.amountPaise, p_signature: null, p_expected_user: null,
      })
      // An order we do not know (e.g. created by another integration on this account) is acknowledged, not retried.
      if (applied.error && !/Unknown Razorpay order/i.test(applied.error.message)) throw applied.error
    }
    await db.from('payment_events').upsert({
      provider_event_id: eventId, event_type: String(payload?.event ?? 'unknown'),
      razorpay_order_id: payload?.payload?.payment?.entity?.order_id ?? null,
      razorpay_payment_id: payload?.payload?.payment?.entity?.id ?? null,
      payload: { event: payload?.event, created_at: payload?.created_at },
    }, { onConflict: 'provider_event_id', ignoreDuplicates: true })
    return new Response('ok', { status: 200 })
  } catch (err) {
    console.error('[razorpay-webhook] processing error', (err as Error)?.message)
    return new Response('Retry', { status: 500 })   // Razorpay will redeliver
  }
})
