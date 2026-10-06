// Turns Supabase / PostgREST / Postgres / Razorpay failures into messages a student can act on.
// Technical detail goes to the console only; raw JSON or SQL text never reaches the UI.

export function logError(context: string, error: unknown) {
  console.error(`[crave:${context}]`, error)
}

const businessMessages: RegExp[] = [
  /^Insufficient stock/, /^Item ".*" is unavailable/, /^Pickup slot/, /^Outlet is/, /^Outlet not found/, /^Cart is empty/, /^Too many items/,
  /^Invalid quantity/, /^Invalid customization/, /^Please choose/, /^Too many ".*" choices/, /^Order total is too small/, /^Only active student accounts/,
  /^You can only review/, /^You can only submit/, /^Rating must/, /^Review text is limited/, /^This order has/, /^This order can no longer/,
  /^Only management can/, /^Only vendors can/, /^Token (already used|expired)/, /^Invalid pickup token/, /^Order is not ready/,
  /^Illegal order transition/, /^Review ownership/, /^This review is hidden/, /^Reply must be/, /^You can only reply/,
  /^Administrators cannot/, /^Unauthorized: Requires ADMIN/, /^Order not found/, /^User not found/, /^Review not found/,
]

export class PaymentInProgressError extends Error {
  orderId: string
  constructor(orderId: string) { super('You already have a payment in progress.'); this.orderId = orderId }
}

export function friendlyError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof PaymentInProgressError) return error.message
  const raw = typeof error === 'string' ? error : (error as { message?: string })?.message ?? ''
  const code = (error as { code?: string })?.code ?? ''
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(raw)) return "Can't reach Crave right now. Check your connection and try again."
  if (/jwt expired|invalid jwt|refresh token|not authenticated|Authentication required/i.test(raw)) return 'Your session expired. Please sign in again.'
  if (code === '42501' || /row-level security|permission denied/i.test(raw)) {
    if (/Illegal order transition/i.test(raw)) return 'That order change is not allowed right now.'
    if (/cannot change your own role/i.test(raw)) return "You can't change your own role or status."
    return "You don't have permission to do that."
  }
  if (code === '23505' || /duplicate key/i.test(raw)) return 'That has already been saved.'
  if (code === '23514' || /violates check constraint/i.test(raw)) return 'Please check the values you entered.'
  if (/^PAYMENT_IN_PROGRESS/.test(raw)) return 'You already have a payment in progress.'
  if (businessMessages.some((re) => re.test(raw))) return raw
  return fallback
}

/** Extracts the pending order id from the place_order PAYMENT_IN_PROGRESS:<uuid> exception. */
export function parsePaymentInProgress(error: unknown): PaymentInProgressError | null {
  const raw = (error as { message?: string })?.message ?? ''
  const match = raw.match(/PAYMENT_IN_PROGRESS:([0-9a-f-]{36})/i)
  return match ? new PaymentInProgressError(match[1]) : null
}

export const isUuid = (value: string | undefined | null): value is string => !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
