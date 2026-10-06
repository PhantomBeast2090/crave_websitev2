import { logError } from '../errors'
import { supabase } from '../supabase'
import type { Order } from '../../types'
import { fetchOrder } from './orders'

type CheckoutOptions = { key_id: string; razorpay_order_id: string; amount: number; currency: string; order_id: string }
type RazorpaySuccess = { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }
type RazorpayInstance = { open: () => void; on: (event: string, handler: (response: unknown) => void) => void }
declare global { interface Window { Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance } }

export type PaymentOutcome =
  | { kind: 'paid'; order: Order }
  | { kind: 'cancelled'; order: Order | null }
  | { kind: 'failed'; order: Order | null }
  | { kind: 'confirming'; order: Order | null }   // paid on Razorpay's side, our server has not confirmed yet

let scriptPromise: Promise<void> | null = null
function loadCheckoutScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve()
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://checkout.razorpay.com/v1/checkout.js'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => { scriptPromise = null; reject(new Error('Could not load the payment window.')) }
    document.head.appendChild(script)
  })
  return scriptPromise
}

async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase!.functions.invoke(name, { body })
  if (error) {
    // functions.invoke hides the JSON body of non-2xx responses inside error.context
    let message = ''
    try { message = (await (error as { context?: Response }).context?.json())?.error ?? '' } catch { /* not JSON */ }
    logError(`fn:${name}`, error)
    throw new Error(message || 'We could not reach the payment service. Please try again.')
  }
  return data as T
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const isPaid = (order: Order | null) => !!order && ['PAID', 'CAPTURED'].includes(order.paymentStatus)

/** After a success callback whose verification call failed, the webhook may still confirm. */
async function waitForConfirmation(orderId: string, attempts = 12): Promise<Order | null> {
  let last: Order | null = null
  for (let i = 0; i < attempts; i++) {
    try { last = await fetchOrder(orderId); if (isPaid(last)) return last } catch (error) { logError('payment:poll', error) }
    await sleep(2500)
  }
  return last
}

export async function startPrepayment(orderId: string): Promise<CheckoutOptions> {
  return callFunction<CheckoutOptions>('create-razorpay-order', { order_id: orderId })
}

/**
 * Opens Razorpay Checkout for an order the server already priced, and resolves with what actually
 * happened. Nothing here marks an order paid: only the server does, after verifying the signature.
 */
/** Razorpay wants a bare 10-digit Indian mobile number; anything else is left for the student to type. */
export const razorpayContact = (phone?: string | null) => { const digits = (phone ?? '').replace(/\D/g, '').slice(-10); return /^[6-9]\d{9}$/.test(digits) ? digits : undefined }

export async function payForOrder(orderId: string, prefill: { name?: string; email?: string; contact?: string }): Promise<PaymentOutcome> {
  await loadCheckoutScript()
  const options = await startPrepayment(orderId)
  if (!window.Razorpay) throw new Error('Could not load the payment window.')

  return new Promise<PaymentOutcome>((resolve) => {
    let settled = false
    let sawFailure = false
    let verifying = false   // a success callback is in flight: dismissal must not claim 'cancelled'
    const finish = (outcome: PaymentOutcome) => { if (!settled) { settled = true; resolve(outcome) } }

    const rzp = new window.Razorpay!({
      key: options.key_id, order_id: options.razorpay_order_id, amount: options.amount, currency: options.currency,
      name: 'Crave', description: 'Campus food pickup', prefill, theme: { color: '#ff5c35' },
      timeout: 600, retry: { enabled: true, max_count: 3 },
      handler: async (response: RazorpaySuccess) => {
        verifying = true
        try {
          await callFunction('verify-razorpay-payment', {
            razorpay_order_id: response.razorpay_order_id, razorpay_payment_id: response.razorpay_payment_id, razorpay_signature: response.razorpay_signature,
          })
          finish({ kind: 'paid', order: (await fetchOrder(orderId))! })
        } catch (error) {
          logError('payment:verify', error)
          // Money may have moved. Never tell the student it failed; wait for the webhook instead.
          const order = await waitForConfirmation(orderId)
          finish(isPaid(order) ? { kind: 'paid', order: order! } : { kind: 'confirming', order })
        }
      },
      modal: {
        confirm_close: true,
        escape: false,
        ondismiss: async () => {
          // Closed without a success callback: ask the server before claiming nothing was charged.
          await sleep(1200)
          if (settled || verifying) return
          let order: Order | null = null
          try { order = await fetchOrder(orderId) } catch (error) { logError('payment:dismiss', error) }
          finish(isPaid(order) ? { kind: 'paid', order: order! } : sawFailure ? { kind: 'failed', order } : { kind: 'cancelled', order })
        },
      },
    })
    rzp.on('payment.failed', (response) => { sawFailure = true; logError('payment:failed', response) })
    rzp.open()
  })
}

export const paymentMessages = {
  cancelled: { title: 'Payment cancelled', body: 'No amount was charged.' },
  failed: { title: 'Payment failed', body: "We couldn't complete your payment. Please try again." },
  confirming: { title: "We're confirming your payment", body: "Your payment went through on Razorpay's side. This can take a minute — please don't pay again. Check My Orders shortly." },
} as const

