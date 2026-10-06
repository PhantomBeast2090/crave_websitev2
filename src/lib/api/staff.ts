// Vendor + management data access. Every call relies on RLS / SECURITY DEFINER checks in the
// database; nothing here decides who may see what.
import type { Order, Outlet } from '../../types'
import { supabase } from '../supabase'
import { cleanSearch } from '../ui-helpers'
import { mapOrder } from './orders'
import { mapOutlet } from './catalog'

function db() {
  if (!supabase) throw new Error('Crave is not configured for this environment.')
  return supabase
}
type Row = Record<string, any>

const STAFF_ORDER_SELECT = `id,order_number,status,payment_status,payment_method,subtotal,tax,total,outlet_id,user_id,created_at,accepted_at,preparing_at,ready_at,picked_up_at,cancelled_at,cancellation_reason,payment_expires_at,
  outlets(name),customer:profiles!orders_user_id_fkey(name),pickup_slots(slot_date,start_time,end_time),pickup_tokens(token_value,is_used),
  order_items(id,food_item_id,food_name,quantity,unit_price,total_price,special_instructions,order_item_customizations(option_name))`

// ---- Vendor ----------------------------------------------------------------------------------
export type VendorDashboard = {
  ordersToday: number; revenueToday: number; newOrders: number; activeOrders: number; completedToday: number
  outlets: { id: string; name: string; rating: number; totalReviews: number; isOpen: boolean; isActive: boolean; ordersToday: number; activeOrders: number }[]
  trend: { date: string; orders: number; revenue: number }[]
}

export async function fetchVendorDashboard(outletId: string | null): Promise<VendorDashboard> {
  const { data, error } = await db().rpc('get_vendor_dashboard', { p_outlet_id: outletId })
  if (error) throw error
  return data as VendorDashboard
}

const OUTLET_COLUMNS = 'id,name,description,image_url,vendor_id,is_open,is_active,building,floor,location_description,rating,total_reviews,operating_hours'
export async function fetchVendorOutlets(vendorId: string): Promise<(Outlet & { isActive: boolean })[]> {
  const { data, error } = await db().from('outlets').select(OUTLET_COLUMNS).eq('vendor_id', vendorId).is('deleted_at', null).order('name')
  if (error) throw error
  return (data ?? []).map((row) => ({ ...mapOutlet(row as any), isActive: Boolean(row.is_active) }))
}

export async function fetchVendorOrders(outletId: string | null, scope: 'active' | 'history', limit = 60): Promise<Order[]> {
  let request = db().from('orders').select(STAFF_ORDER_SELECT).order('created_at', { ascending: scope === 'active' }).limit(limit)
  request = scope === 'active' ? request.in('status', ['PLACED', 'ACCEPTED', 'PREPARING', 'READY']) : request.in('status', ['PICKED_UP', 'REJECTED', 'CANCELLED', 'EXPIRED'])
  if (outletId) request = request.eq('outlet_id', outletId)
  const { data, error } = await request
  if (error) throw error
  return (data ?? []).map((row) => mapOrder(row, true))
}

export type VendorAction = 'accept' | 'prepare' | 'ready' | 'reject'
export async function vendorOrderAction(orderId: string, action: VendorAction, reason?: string) {
  const fn = { accept: 'vendor_accept_order', prepare: 'vendor_start_preparing', ready: 'vendor_mark_ready', reject: 'vendor_reject_order' }[action]
  const { error } = await db().rpc(fn, action === 'reject' ? { p_order_id: orderId, p_reason: reason ?? null } : { p_order_id: orderId })
  if (error) throw error
}

export async function verifyPickupToken(token: string): Promise<{ order_number: string }> {
  const { data, error } = await db().rpc('verify_pickup_token', { p_token: token.trim() })
  if (error) throw error
  return data as { order_number: string }
}

export async function setOutletOpen(outletId: string, isOpen: boolean) {
  const { error } = await db().from('outlets').update({ is_open: isOpen }).eq('id', outletId)
  if (error) throw error
}

export type StaffFood = { id: string; name: string; price: number; isAvailable: boolean; outletId: string; outletName: string; category: string; stock: number | null; lowStockAt: number; isVeg: boolean }
const mapStaffFood = (row: Row): StaffFood => {
  const inv = Array.isArray(row.inventory) ? row.inventory[0] : row.inventory
  return { id: row.id, name: row.name, price: Number(row.price), isAvailable: Boolean(row.is_available), outletId: row.outlet_id, outletName: row.outlets?.name ?? '', category: row.categories?.name ?? '', stock: inv?.quantity_available ?? null, lowStockAt: inv?.low_stock_threshold ?? 5, isVeg: Boolean(row.is_veg) }
}

export async function fetchStaffFoods(input: { outletId?: string | null; search?: string; page?: number; pageSize?: number }): Promise<{ foods: StaffFood[]; total: number }> {
  const pageSize = input.pageSize ?? 30, page = input.page ?? 0
  let request = db().from('food_items').select('id,name,price,is_available,is_veg,outlet_id,outlets(name),categories(name),inventory(quantity_available,low_stock_threshold)', { count: 'exact' }).is('deleted_at', null).order('name')
  if (input.outletId) request = request.eq('outlet_id', input.outletId)
  const search = cleanSearch(input.search ?? '')
  if (search) request = request.ilike('name', `%${search}%`)
  const { data, error, count } = await request.range(page * pageSize, page * pageSize + pageSize - 1)
  if (error) throw error
  return { foods: (data ?? []).map(mapStaffFood), total: count ?? 0 }
}

export async function setFoodAvailability(foodId: string, available: boolean) {
  const { error } = await db().from('food_items').update({ is_available: available }).eq('id', foodId)
  if (error) throw error
}

export async function setFoodPrice(foodId: string, price: number) {
  if (!Number.isFinite(price) || price <= 0 || price > 10000) throw new Error('Enter a price between ₹1 and ₹10,000.')
  const { error } = await db().from('food_items').update({ price }).eq('id', foodId)
  if (error) throw error
}

export async function setStock(foodId: string, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 1_000_000) throw new Error('Enter a whole number between 0 and 1,000,000.')
  const { data, error } = await db().from('inventory').update({ quantity_available: quantity }).eq('food_item_id', foodId).select('food_item_id')
  if (error) throw error
  if (!data?.length) throw new Error("You can't change stock for this item.")
}

// ---- Management ------------------------------------------------------------------------------
export type Dashboard = {
  generatedAt: string
  ordersToday: number; ordersThisWeek: number; ordersThisMonth: number
  revenueToday: number; revenueThisWeek: number; revenueThisMonth: number
  totalOrders: number; completedOrders: number; activeOrders: number; cancelledOrders: number; rejectedOrders: number
  paidRevenue: number; razorpayRevenue: number; cashRevenue: number; refundedAmount: number
  failedPayments: number; pendingPayments: number; refundRequiredCount: number; refundRequiredAmount: number
  totalStudents: number; totalVendors: number; pendingVendors: number; totalOutlets: number; activeOutlets: number
  totalFoodItems: number; availableFoodItems: number
  trend: { date: string; orders: number; revenue: number }[]
  topOutlets: { outlet_id: string; name: string; orders: number; revenue: number }[]
}

export async function fetchDashboard(days: number): Promise<Dashboard> {
  const { data, error } = await db().rpc('get_management_dashboard', { p_days: days })
  if (error) throw error
  return data as Dashboard
}

export async function fetchAdminOrders(input: { status?: string; search?: string; page?: number; pageSize?: number }): Promise<{ orders: Order[]; total: number }> {
  const pageSize = input.pageSize ?? 25, page = input.page ?? 0
  let request = db().from('orders').select(STAFF_ORDER_SELECT, { count: 'exact' }).order('created_at', { ascending: false })
  if (input.status && input.status !== 'all') request = request.eq('status', input.status)
  const search = cleanSearch(input.search ?? '')
  if (search) request = request.ilike('order_number', `%${search}%`)
  const { data, error, count } = await request.range(page * pageSize, page * pageSize + pageSize - 1)
  if (error) throw error
  return { orders: (data ?? []).map((row) => mapOrder(row, true)), total: count ?? 0 }
}

export async function adminCancelOrder(orderId: string, reason: string) {
  const { error } = await db().rpc('admin_cancel_order', { p_order_id: orderId, p_reason: reason })
  if (error) throw error
}

export type AdminUser = { id: string; name: string; email: string; role: string; isActive: boolean; phone?: string | null; createdAt: string }
export async function fetchUsers(input: { role?: string; search?: string; page?: number; pageSize?: number }): Promise<{ users: AdminUser[]; total: number }> {
  const pageSize = input.pageSize ?? 25, page = input.page ?? 0
  let request = db().from('profiles').select('id,name,email,role,is_active,phone,created_at', { count: 'exact' }).order('created_at', { ascending: false })
  if (input.role && input.role !== 'all') request = request.eq('role', input.role)
  const search = cleanSearch(input.search ?? '')
  if (search) request = request.or(`name.ilike.*${search}*,email.ilike.*${search}*`)
  const { data, error, count } = await request.range(page * pageSize, page * pageSize + pageSize - 1)
  if (error) throw error
  return { users: (data ?? []).map((r) => ({ id: r.id, name: r.name, email: r.email, role: r.role, isActive: r.is_active, phone: r.phone, createdAt: r.created_at })), total: count ?? 0 }
}

export async function setUserRole(userId: string, role: string) {
  const { error } = await db().rpc('admin_set_user_role', { p_user_id: userId, p_role: role })
  if (error) throw error
}
export async function setUserActive(userId: string, active: boolean) {
  const { error } = await db().rpc('admin_set_user_active', { p_user_id: userId, p_active: active })
  if (error) throw error
}

export async function fetchAdminOutlets(): Promise<(Outlet & { isActive: boolean; vendorName?: string })[]> {
  const { data, error } = await db().from('outlets').select(`${OUTLET_COLUMNS},vendor:profiles!outlets_vendor_id_fkey(name)`).is('deleted_at', null).order('name')
  if (error) throw error
  return (data ?? []).map((row: Row) => ({ ...mapOutlet(row as any), isActive: Boolean(row.is_active), vendorName: row.vendor?.name }))
}

export async function setOutletFlags(outletId: string, flags: { is_open?: boolean; is_active?: boolean }) {
  const { error } = await db().from('outlets').update(flags).eq('id', outletId)
  if (error) throw error
}

export type AdminPayment = { id: string; orderId: string; orderNumber: string; amount: number; status: string; provider: string; razorpayPaymentId: string | null; razorpayOrderId: string | null; createdAt: string; paidAt: string | null; orderStatus: string; customer?: string }
export async function fetchPayments(input: { status?: string; provider?: string; page?: number; pageSize?: number }): Promise<{ payments: AdminPayment[]; total: number }> {
  const pageSize = input.pageSize ?? 25, page = input.page ?? 0
  let request = db().from('payments').select('id,order_id,amount,status,gateway_provider,razorpay_payment_id,razorpay_order_id,created_at,paid_at,orders!inner(order_number,status,customer:profiles!orders_user_id_fkey(name))', { count: 'exact' }).order('created_at', { ascending: false })
  if (input.status && input.status !== 'all') request = request.eq('status', input.status)
  if (input.provider && input.provider !== 'all') request = request.eq('gateway_provider', input.provider)
  const { data, error, count } = await request.range(page * pageSize, page * pageSize + pageSize - 1)
  if (error) throw error
  return {
    total: count ?? 0,
    payments: (data ?? []).map((r: Row) => ({
      id: r.id, orderId: r.order_id, orderNumber: r.orders?.order_number, amount: Number(r.amount), status: r.status, provider: r.gateway_provider,
      razorpayPaymentId: r.razorpay_payment_id, razorpayOrderId: r.razorpay_order_id, createdAt: r.created_at, paidAt: r.paid_at, orderStatus: r.orders?.status, customer: r.orders?.customer?.name,
    })),
  }
}

export type RefundCandidate = { order_id: string; order_number: string; amount: number; order_status: string; student_name: string; razorpay_payment_id: string; paid_at: string }
export async function fetchRefundCandidates(): Promise<RefundCandidate[]> {
  const { data, error } = await db().rpc('admin_refund_candidates')
  if (error) throw error
  return (data ?? []) as RefundCandidate[]
}

export async function refundOrder(orderId: string) {
  const { data, error } = await db().functions.invoke('refund-razorpay-payment', { body: { order_id: orderId } })
  if (error) {
    let message = ''
    try { message = (await (error as { context?: Response }).context?.json())?.error ?? '' } catch { /* not JSON */ }
    throw new Error(message || 'The refund could not be processed. Please try again.')
  }
  return data as { success: boolean; refund_id: string | null }
}

export type AdminSlot = { id: string; outletId: string; outletName: string; slotDate: string; startTime: string; endTime: string; capacity: number; bookedCount: number; status: string }
export async function fetchSlots(input: { outletId?: string | null; date: string }): Promise<AdminSlot[]> {
  let request = db().from('pickup_slots').select('id,outlet_id,slot_date,start_time,end_time,capacity,booked_count,status,outlets(name)').eq('slot_date', input.date).order('start_time').limit(400)
  if (input.outletId) request = request.eq('outlet_id', input.outletId)
  const { data, error } = await request
  if (error) throw error
  return (data ?? []).map((r: Row) => ({ id: r.id, outletId: r.outlet_id, outletName: r.outlets?.name ?? '', slotDate: r.slot_date, startTime: r.start_time, endTime: r.end_time, capacity: r.capacity, bookedCount: r.booked_count, status: r.status }))
}

export async function setSlotCapacity(slotId: string, capacity: number, booked: number) {
  if (!Number.isInteger(capacity) || capacity < Math.max(1, booked) || capacity > 500) throw new Error(`Capacity must be a whole number between ${Math.max(1, booked)} and 500.`)
  const { error } = await db().from('pickup_slots').update({ capacity }).eq('id', slotId)
  if (error) throw error
}
