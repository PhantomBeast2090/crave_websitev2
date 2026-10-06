import type { Order, OrderStatus, PaymentStatus, CartLine } from '../../types'
import { PaymentInProgressError, parsePaymentInProgress } from '../errors'
import { supabase } from '../supabase'
import { formatTime12, istToday } from '../time'

function db() {
  if (!supabase) throw new Error('Crave is not configured for this environment.')
  return supabase
}

export type Slot = { id: string; outletId: string; slotDate: string; startTime: string; endTime: string; capacity: number; bookedCount: number; status: string; label: string }

/** Slots for one outlet from today (IST) onward; the UI filters what is still bookable. */
export async function fetchPickupSlots(outletId: string, daysAhead = 8): Promise<Slot[]> {
  const today = istToday()
  const last = new Date(`${today}T00:00:00Z`); last.setUTCDate(last.getUTCDate() + daysAhead)
  const { data, error } = await db().from('pickup_slots').select('id,outlet_id,slot_date,start_time,end_time,capacity,booked_count,status')
    .eq('outlet_id', outletId).gte('slot_date', today).lte('slot_date', last.toISOString().slice(0, 10)).in('status', ['AVAILABLE', 'LIMITED'])
    .order('slot_date').order('start_time').limit(400)
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id, outletId: row.outlet_id, slotDate: row.slot_date, startTime: row.start_time, endTime: row.end_time,
    capacity: row.capacity, bookedCount: row.booked_count, status: row.status,
    label: `${formatTime12(row.start_time)} – ${formatTime12(row.end_time)}`,
  }))
}

const ORDER_SELECT = `id,order_number,status,payment_status,payment_method,subtotal,tax,total,outlet_id,created_at,accepted_at,preparing_at,ready_at,picked_up_at,cancelled_at,cancellation_reason,payment_expires_at,
  outlets(name),pickup_slots(slot_date,start_time,end_time),pickup_tokens(token_value,is_used),
  order_items(id,food_item_id,food_name,quantity,unit_price,total_price,special_instructions,order_item_customizations(option_name))`

type OrderRow = Record<string, any>

export function mapOrder(row: OrderRow, withCustomer = false): Order {
  const slot = Array.isArray(row.pickup_slots) ? row.pickup_slots[0] : row.pickup_slots
  const token = Array.isArray(row.pickup_tokens) ? row.pickup_tokens[0] : row.pickup_tokens
  const outlet = Array.isArray(row.outlets) ? row.outlets[0] : row.outlets
  return {
    id: row.id, number: row.order_number, status: row.status as OrderStatus, paymentStatus: row.payment_status as PaymentStatus,
    paymentMethod: row.payment_method, subtotal: Number(row.subtotal), tax: Number(row.tax), total: Number(row.total),
    outletId: row.outlet_id, outletName: outlet?.name ?? 'Outlet', customerName: withCustomer ? row.customer?.name : undefined,
    createdAt: row.created_at, acceptedAt: row.accepted_at, preparingAt: row.preparing_at, readyAt: row.ready_at, pickedUpAt: row.picked_up_at,
    cancelledAt: row.cancelled_at, cancellationReason: row.cancellation_reason, paymentExpiresAt: row.payment_expires_at,
    slotDate: slot?.slot_date, slotStart: slot?.start_time, slotEnd: slot?.end_time, token: token?.token_value ?? null, tokenUsed: token?.is_used ?? false,
    items: (row.order_items ?? []).map((item: OrderRow) => ({
      id: item.id, foodItemId: item.food_item_id, name: item.food_name, quantity: item.quantity, unitPrice: Number(item.unit_price),
      totalPrice: Number(item.total_price), note: item.special_instructions,
      options: (item.order_item_customizations ?? []).map((c: OrderRow) => c.option_name),
    })),
  }
}

export async function fetchMyOrders(userId: string, limit = 50): Promise<Order[]> {
  const { data, error } = await db().from('orders').select(ORDER_SELECT).eq('user_id', userId).order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return (data ?? []).map((row) => mapOrder(row))
}

export async function fetchOrder(orderId: string): Promise<Order | null> {
  const { data, error } = await db().from('orders').select(ORDER_SELECT).eq('id', orderId).maybeSingle()
  if (error) throw error
  return data ? mapOrder(data) : null
}

export function subscribeToOrders(onChange: () => void): () => void {
  const client = db()
  const channel = client.channel(`crave-orders-${Math.random().toString(36).slice(2)}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, onChange).subscribe()
  return () => { void client.removeChannel(channel) }
}

/**
 * Deterministic cart hand-off: the server cart is rebuilt from the single local cart immediately
 * before place_order, in one request per table, so "cart says 2, order says 3" cannot happen.
 */
async function syncServerCart(userId: string, lines: CartLine[]): Promise<string> {
  const client = db()
  const outletId = lines[0].outletId
  if (lines.some((line) => line.outletId !== outletId)) throw new Error('One outlet per order — finish this bag first.')

  const existing = await client.from('carts').select('id').eq('user_id', userId).maybeSingle()
  if (existing.error) throw existing.error
  let cartId = existing.data?.id as string | undefined
  if (!cartId) {
    const created = await client.from('carts').insert({ user_id: userId, outlet_id: outletId }).select('id').single()
    if (created.error) throw created.error
    cartId = created.data.id as string
  }
  const clear = await client.from('cart_items').delete().eq('cart_id', cartId)
  if (clear.error) throw clear.error
  const outlet = await client.from('carts').update({ outlet_id: outletId }).eq('id', cartId)
  if (outlet.error) throw outlet.error

  // `price` is required by the schema but ignored by place_order (the DB reads food_items.price).
  const inserted = await client.from('cart_items').insert(lines.map((line) => ({
    cart_id: cartId, food_item_id: line.foodId, quantity: line.quantity, price: line.price, is_veg: line.isVeg,
    special_instructions: line.note?.trim().slice(0, 200) || null,
  }))).select('id')
  if (inserted.error) throw inserted.error
  if ((inserted.data ?? []).length !== lines.length) throw new Error('Could not prepare your bag. Please try again.')

  const customizations = lines.flatMap((line, index) => line.options.map((option) => ({
    cart_item_id: inserted.data![index].id, variant_id: option.variantId, option_id: option.id, extra_price: option.extraPrice,
  })))
  if (customizations.length) {
    const result = await client.from('cart_item_customizations').insert(customizations)
    if (result.error) throw result.error
  }
  return cartId
}

export async function placeOrder(userId: string, lines: CartLine[], slotId: string, method: 'PAY_AT_COUNTER' | 'ONLINE'): Promise<Order> {
  if (!lines.length) throw new Error('Cart is empty.')
  const cartId = await syncServerCart(userId, lines)
  const placed = await db().rpc('place_order', { p_cart_id: cartId, p_pickup_slot_id: slotId, p_payment_method: method })
  if (placed.error) {
    const pending = parsePaymentInProgress(placed.error)
    if (pending) throw pending
    throw placed.error
  }
  const order = await fetchOrder(String(placed.data))
  if (!order) throw new Error('Your order was placed but could not be loaded. Check My Orders.')
  // Defensive check that what the server booked is exactly what the student saw.
  const expected = lines.reduce((sum, line) => sum + line.quantity, 0)
  const actual = order.items.reduce((sum, item) => sum + item.quantity, 0)
  if (expected !== actual) console.error('[crave:order] quantity mismatch', { expected, actual, order: order.id })
  return order
}

export async function cancelMyOrder(orderId: string, reason?: string) {
  const { error } = await db().rpc('cancel_my_order', { p_order_id: orderId, p_reason: reason ?? null })
  if (error) throw error
}

export { PaymentInProgressError }
