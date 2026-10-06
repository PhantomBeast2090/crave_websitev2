import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { decideWebhookAction, hmacSha256Hex, timingSafeEqualHex, verifyCheckoutSignature, verifyWebhookSignature, isRazorpayOrderId } from '../../supabase/functions/_shared/razorpay.ts'

const secret = 'test_secret_not_real'
const ref = (msg, key = secret) => createHmac('sha256', key).update(msg).digest('hex')

test('hmac matches Node crypto', async () => { assert.equal(await hmacSha256Hex(secret, 'order_ABC123|pay_XYZ789'), ref('order_ABC123|pay_XYZ789')) })

test('checkout signature: valid, tampered payment, tampered order, wrong secret', async () => {
  const sig = ref('order_ABC123xx|pay_XYZ789xx')
  assert.equal(await verifyCheckoutSignature('order_ABC123xx', 'pay_XYZ789xx', sig, secret), true)
  assert.equal(await verifyCheckoutSignature('order_ABC123xx', 'pay_OTHER789', sig, secret), false)
  assert.equal(await verifyCheckoutSignature('order_OTHER123', 'pay_XYZ789xx', sig, secret), false)
  assert.equal(await verifyCheckoutSignature('order_ABC123xx', 'pay_XYZ789xx', sig, 'wrong'), false)
})

test('fake / malformed signatures are rejected', async () => {
  for (const bad of ['', 'abc', 'g'.repeat(64), '0'.repeat(64), ref('x').toUpperCase(), null, undefined, 123])
    assert.equal(await verifyCheckoutSignature('order_ABC123xx', 'pay_XYZ789xx', bad, secret), false, String(bad))
  assert.equal(await verifyCheckoutSignature('order_ABC123xx', 'pay_XYZ789xx', ref('order_ABC123xx|pay_XYZ789xx'), ''), false, 'empty secret never verifies')
  assert.equal(await verifyCheckoutSignature('order_ABC123xx|pay_x', 'pay_XYZ789xx', ref('order_ABC123xx|pay_x|pay_XYZ789xx'), secret), false, 'delimiter injection')
})

test('webhook signature covers the raw body', async () => {
  const body = JSON.stringify({ event: 'payment.captured' })
  assert.equal(await verifyWebhookSignature(body, ref(body), secret), true)
  assert.equal(await verifyWebhookSignature(body + ' ', ref(body), secret), false)
  assert.equal(await verifyWebhookSignature(body, null, secret), false)
  assert.equal(await verifyWebhookSignature(body, ref(body), ''), false)
})

test('timingSafeEqualHex', () => {
  assert.equal(timingSafeEqualHex('ab', 'ab'), true); assert.equal(timingSafeEqualHex('ab', 'ac'), false); assert.equal(timingSafeEqualHex('ab', 'abc'), false)
})

test('id validators', () => { assert.equal(isRazorpayOrderId('order_Abc123XYZ'), true); assert.equal(isRazorpayOrderId("order_x'; drop"), false) })

test('webhook decisions', () => {
  const pay = (event, status, extra = {}) => ({ event, payload: { payment: { entity: { id: 'pay_ABCDEF123', order_id: 'order_ABCDEF123', amount: 10500, status, ...extra } } } })
  assert.deepEqual(decideWebhookAction(pay('payment.captured', 'captured')), { kind: 'paid', razorpayOrderId: 'order_ABCDEF123', razorpayPaymentId: 'pay_ABCDEF123', amountPaise: 10500 })
  assert.equal(decideWebhookAction(pay('payment.failed', 'failed')).kind, 'failed')
  assert.equal(decideWebhookAction(pay('payment.authorized', 'authorized')).kind, 'authorized')
  assert.equal(decideWebhookAction(pay('payment.captured', 'failed')).kind, 'ignore', 'captured event with non-captured entity')
  assert.equal(decideWebhookAction(pay('refund.processed', 'processed')).kind, 'ignore')
  assert.equal(decideWebhookAction({ event: 'payment.captured', payload: {} }).kind, 'ignore')
  assert.equal(decideWebhookAction(pay('payment.captured', 'captured', { order_id: 'not-an-order' })).kind, 'ignore')
})
