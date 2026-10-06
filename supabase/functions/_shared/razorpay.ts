// Pure Razorpay helpers (Web Crypto only) so they run in Deno edge functions and in Node tests.

const encoder = new TextEncoder()

export async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)))
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Constant-time comparison of two hex strings (length leak only). */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export const isRazorpayOrderId = (v: unknown): v is string => typeof v === 'string' && /^order_[A-Za-z0-9]{6,40}$/.test(v)
export const isRazorpayPaymentId = (v: unknown): v is string => typeof v === 'string' && /^pay_[A-Za-z0-9]{6,40}$/.test(v)
export const isHexSignature = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v)
export const isUuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)

/** Checkout success callback: HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export async function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string, keySecret: string): Promise<boolean> {
  if (!keySecret || !isRazorpayOrderId(orderId) || !isRazorpayPaymentId(paymentId) || !isHexSignature(signature)) return false
  return timingSafeEqualHex(await hmacSha256Hex(keySecret, `${orderId}|${paymentId}`), signature)
}

/** Webhook: HMAC_SHA256(raw request body, webhook_secret) in x-razorpay-signature. */
export async function verifyWebhookSignature(rawBody: string, signature: string | null, webhookSecret: string): Promise<boolean> {
  if (!webhookSecret || !signature || !isHexSignature(signature)) return false
  return timingSafeEqualHex(await hmacSha256Hex(webhookSecret, rawBody), signature)
}

export type WebhookDecision =
  | { kind: 'paid' | 'failed' | 'authorized'; razorpayOrderId: string; razorpayPaymentId: string; amountPaise: number }
  | { kind: 'ignore' }

/** Maps a verified Razorpay webhook payload to the state change we care about. */
export function decideWebhookAction(payload: any): WebhookDecision {
  const event: string = payload?.event ?? ''
  const payment = payload?.payload?.payment?.entity
  const orderEntity = payload?.payload?.order?.entity
  const map: Record<string, 'paid' | 'failed' | 'authorized'> = {
    'payment.captured': 'paid', 'order.paid': 'paid', 'payment.failed': 'failed', 'payment.authorized': 'authorized',
  }
  const kind = map[event]
  if (!kind) return { kind: 'ignore' }
  const razorpayOrderId = payment?.order_id ?? orderEntity?.id
  const razorpayPaymentId = payment?.id
  const amountPaise = Number(payment?.amount ?? orderEntity?.amount_paid)
  if (!isRazorpayOrderId(razorpayOrderId) || !isRazorpayPaymentId(razorpayPaymentId) || !Number.isFinite(amountPaise)) return { kind: 'ignore' }
  // A `payment.captured` that is not actually captured, or `failed` for a captured payment, is ignored.
  if (kind === 'paid' && payment && payment.status && payment.status !== 'captured') return { kind: 'ignore' }
  return { kind, razorpayOrderId, razorpayPaymentId, amountPaise }
}
