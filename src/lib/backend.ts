import type { Session, SupabaseClient } from '@supabase/supabase-js'
import {
  type Category,
  type CartItem,
  type CustomizationGroup,
  type CustomizationOption,
  type Food,
  type Outlet,
  type CraveOrder,
  type Tone,
} from '../data/campusData'
import { supabase } from './supabase'

type LiveOutletRow = {
  id: string
  name: string
  description?: string | null
  image_url?: string | null
  vendor_id?: string | null
  is_open?: boolean | null
  is_active?: boolean | null
  building?: string | null
  floor?: string | null
  location_description?: string | null
  rating?: number | null
  total_reviews?: number | null
}

type LiveCategoryRow = {
  id: string
  name: string
  emoji?: string | null
}

type LiveVariantOptionRow = {
  id: string
  variant_id: string
  name: string
  extra_price?: number | null
}

type LiveVariantRow = {
  id: string
  food_item_id: string
  name: string
  is_required?: boolean | null
  max_selections?: number | null
  food_variant_options?: LiveVariantOptionRow[] | null
}

type LiveFoodRow = {
  id: string
  outlet_id: string
  category_id?: string | null
  name: string
  description?: string | null
  image_url?: string | null
  price: number
  is_veg?: boolean | null
  is_available?: boolean | null
  prep_time_minutes?: number | null
  rating?: number | null
  total_reviews?: number | null
  tags?: string[] | null
  is_popular?: boolean | null
  is_recommended?: boolean | null
  outlets?: Pick<LiveOutletRow, 'name'> | null
  categories?: Pick<LiveCategoryRow, 'name' | 'emoji'> | null
  food_variants?: LiveVariantRow[] | null
}

type LivePickupSlotRow = {
  id: string
  outlet_id: string
  slot_date: string
  start_time: string
  end_time: string
  capacity: number
  booked_count: number
  status: string
}

type LiveOrderRow = {
  id: string
  order_number: string
  outlet_id: string
  outlet_name?: string | null
  outlets?: Pick<LiveOutletRow, 'name'> | Pick<LiveOutletRow, 'name'>[] | null
  total: number
  status: string
  pickup_slots?: { start_time?: string; end_time?: string; slot_date?: string } | null
  pickup_tokens?: { token_value?: string | null; expires_at?: string | null } | Array<{ token_value?: string | null; expires_at?: string | null }> | null
  items?: Array<{ food_name: string; quantity: number }>
}

export type LiveCatalog = {
  outlets: Outlet[]
  foods: Food[]
  categories: Category[]
}

export type CraveRole = 'STUDENT' | 'VENDOR' | 'ADMIN'

export type LivePickupSlot = {
  id: string
  outletId: string
  label: string
  slotDate: string
  startTime: string
  endTime: string
  capacity: number
  bookedCount: number
  status: string
}

const tones: Tone[] = ['tangerine', 'chartreuse', 'lavender', 'aqua', 'sun']
const emojis = ['🥪', '🍜', '🥗', '🥤', '🍰', '🍛', '🌯', '☕']

function stableIndex(value: string) {
  return [...value].reduce((sum, character) => sum + character.charCodeAt(0), 0)
}

function toneFor(value: string) {
  return tones[stableIndex(value) % tones.length]
}

function emojiFor(name: string, categoryEmoji?: string | null) {
  if (categoryEmoji?.trim()) return categoryEmoji
  return emojis[stableIndex(name) % emojis.length]
}

function emojiForFood(name: string, categoryName?: string | null) {
  const text = `${name} ${categoryName || ''}`.toLowerCase()
  if (/biryani|pulao/.test(text)) return '🍛'
  if (/roll|shawarma|wrap|kubos|paratha wrap/.test(text)) return '🌯'
  if (/burger/.test(text)) return '🍔'
  if (/sandwich|club|bread omelet/.test(text)) return '🥪'
  if (/pizza/.test(text)) return '🍕'
  if (/momo/.test(text)) return '🥟'
  if (/dosa|idli|uttapam/.test(text)) return '🥞'
  if (/naan|roti|chapati|parotta|pulk|kulcha|bread/.test(text)) return '🫓'
  if (/noodle|maggi|pasta/.test(text)) return '🍜'
  if (/fried rice|rice/.test(text)) return '🍚'
  if (/samosa|vada pav|pakoda|fry|fries|snack/.test(text)) return '🍟'
  if (/egg|omelet|omlette/.test(text)) return '🍳'
  if (/chicken|mutton|fish|prawn|seafood|tandoori|kabab|kebab/.test(text)) return '🍗'
  if (/gravy|curry|masala|korma|paneer|dal|bhartha|gobi|aloo|bhindi/.test(text)) return '🍲'
  if (/chat|chaat|salad/.test(text)) return '🥗'
  if (/juice|shake|lassi|mojito|soda|lime|booster|milk/.test(text)) return '🥤'
  if (/ice cream|kulfi|brownie|cake|caramel|bounty|treat/.test(text)) return '🍨'
  if (/corn/.test(text)) return '🌽'
  if (/coffee|tea/.test(text)) return '☕'
  if (/fresh fruit|fruit|apple|banana|avocado|blueberry|blackberry|cherry|carrot|beetroot/.test(text)) return '🍎'
  return '🍽️'
}

function locationFor(outlet: LiveOutletRow) {
  return [outlet.building, outlet.floor].filter(Boolean).join(' · ') || outlet.location_description || 'SRMIST campus'
}

function formatTime(value: string) {
  const [hours = '0', minutes = '00'] = value.split(':')
  const hour = Number(hours)
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const twelveHour = hour % 12 || 12
  return `${twelveHour}:${minutes} ${suffix}`
}

function mapOutlets(rows: LiveOutletRow[]) {
  return rows.map((outlet) => ({
    id: outlet.id,
    name: outlet.name,
    location: locationFor(outlet),
    eta: '10–20 min',
    rating: Number(outlet.rating ?? 0),
    orders: `${outlet.total_reviews ?? 0} reviews`,
    emoji: emojiFor(outlet.name),
    tone: toneFor(outlet.id),
    open: Boolean(outlet.is_open ?? true),
    vibe: outlet.description || 'campus food with main-character energy',
    imageUrl: outlet.image_url,
    vendorId: outlet.vendor_id,
  })) satisfies Outlet[]
}

function mapGroups(rows: LiveVariantRow[] | null | undefined) {
  return (rows ?? []).map((variant) => ({
    id: variant.id,
    name: variant.name,
    isRequired: Boolean(variant.is_required),
    maxSelections: variant.max_selections ?? 1,
    options: (variant.food_variant_options ?? []).map((option) => ({
      id: option.id,
      variantId: variant.id,
      variantName: variant.name,
      name: option.name,
      extraPrice: Number(option.extra_price ?? 0),
    })),
  })) satisfies CustomizationGroup[]
}

function mapFoods(rows: LiveFoodRow[]) {
  return rows.map((food) => {
    const customizationGroups = mapGroups(food.food_variants)
    const customizations = customizationGroups.flatMap((group) => group.options.map((option) => option.name))
    return {
      id: food.id,
      outletId: food.outlet_id,
      name: food.name,
      description: food.description || 'A campus classic, ready when you are.',
      category: food.category_id || 'all',
      price: Number(food.price),
      rating: Number(food.rating ?? 0),
      prep: `${food.prep_time_minutes ?? 10} min`,
      emoji: emojiForFood(food.name, food.categories?.name),
      tone: toneFor(food.id),
      imageUrl: food.image_url,
      isVeg: Boolean(food.is_veg ?? true),
      tag: food.tags?.[0] || (food.is_popular ? 'campus fave' : undefined),
      popular: Boolean(food.is_popular),
      customizations,
      customizationGroups,
    }
  }) satisfies Food[]
}

export async function fetchLiveCatalog(client: SupabaseClient = supabase!) {
  if (!client) throw new Error('Supabase is not configured for this environment.')

  const [outletsResult, categoriesResult, foodsResult] = await Promise.all([
    client.from('outlets').select('*').eq('is_active', true).order('name'),
    client.from('categories').select('*').order('name'),
    client.from('food_items').select('*, outlets(name), categories(name, emoji), food_variants(*, food_variant_options(*))').eq('is_available', true).order('name'),
  ])

  if (outletsResult.error) throw outletsResult.error
  if (categoriesResult.error) throw categoriesResult.error
  if (foodsResult.error) throw foodsResult.error

  const liveCategories = (categoriesResult.data as LiveCategoryRow[]).map((category) => ({
    id: category.id,
    label: category.name,
    emoji: category.emoji || '✦',
  }))

  return {
    outlets: mapOutlets((outletsResult.data ?? []) as LiveOutletRow[]),
    categories: [{ id: 'all', label: 'Everything', emoji: '✦' }, ...liveCategories],
    foods: mapFoods((foodsResult.data ?? []) as LiveFoodRow[]),
  } satisfies LiveCatalog
}

export async function fetchFavoriteIds(userId: string, client: SupabaseClient = supabase!) {
  if (!client) return []
  const { data, error } = await client.from('favorites').select('food_item_id').eq('user_id', userId)
  if (error) throw error
  return (data ?? []).map((row) => row.food_item_id as string)
}

export async function fetchUserRole(userId: string, client: SupabaseClient = supabase!): Promise<CraveRole> {
  if (!client) return 'STUDENT'
  const { data, error } = await client.from('profiles').select('role').eq('id', userId).maybeSingle()
  if (error) throw error
  const role = String(data?.role || 'STUDENT').toUpperCase()
  return role === 'VENDOR' || role === 'ADMIN' ? role : 'STUDENT'
}

export async function setFavorite(foodId: string, userId: string, favorite: boolean, client: SupabaseClient = supabase!) {
  if (!client) return
  if (favorite) {
    const { error } = await client.from('favorites').upsert({ user_id: userId, food_item_id: foodId })
    if (error) throw error
    return
  }
  const { error } = await client.from('favorites').delete().eq('user_id', userId).eq('food_item_id', foodId)
  if (error) throw error
}

export async function fetchPickupSlots(outletId: string, date: string, client: SupabaseClient = supabase!) {
  if (!client) return []
  const { data, error } = await client.from('pickup_slots').select('*').eq('outlet_id', outletId).gte('slot_date', date).in('status', ['AVAILABLE', 'LIMITED']).order('slot_date').order('start_time').limit(12)
  if (error) throw error
  return ((data ?? []) as LivePickupSlotRow[]).map((slot) => ({
    id: slot.id,
    outletId: slot.outlet_id,
    label: `${formatTime(slot.start_time)} – ${formatTime(slot.end_time)}`,
    slotDate: slot.slot_date,
    startTime: slot.start_time,
    endTime: slot.end_time,
    capacity: slot.capacity,
    bookedCount: slot.booked_count,
    status: slot.status,
  }))
}

async function getOrCreateCart(userId: string, outletId: string, client: SupabaseClient) {
  const existing = await client.from('carts').select('id').eq('user_id', userId).maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data?.id) return existing.data.id as string
  const created = await client.from('carts').insert({ user_id: userId, outlet_id: outletId }).select('id').single()
  if (created.error) throw created.error
  return created.data.id as string
}

export async function placeLiveOrder(session: Session, items: CartItem[], pickupSlotId: string, client: SupabaseClient = supabase!) {
  if (!client) throw new Error('Supabase is not configured for this environment.')
  if (!items.length) throw new Error('Your bag is empty.')
  if (!pickupSlotId) throw new Error('Choose a live pickup slot before placing the order.')

  const userId = session.user.id
  const outletId = items[0].outletId
  const cartId = await getOrCreateCart(userId, outletId, client)
  const updateCart = await client.from('carts').update({ outlet_id: outletId }).eq('id', cartId)
  if (updateCart.error) throw updateCart.error

  const clearItems = await client.from('cart_items').delete().eq('cart_id', cartId)
  if (clearItems.error) throw clearItems.error

  for (const item of items) {
    const cartItem = await client.from('cart_items').insert({
      cart_id: cartId,
      food_item_id: item.id,
      quantity: item.quantity,
      price: item.price,
      is_veg: Boolean(item.isVeg ?? true),
      special_instructions: item.note || null,
    }).select('id').single()
    if (cartItem.error) throw cartItem.error

    if (item.selectedOptions?.length) {
      const customizations = await client.from('cart_item_customizations').insert(item.selectedOptions.map((option) => ({
        cart_item_id: cartItem.data.id,
        variant_id: option.variantId,
        option_id: option.id,
        extra_price: option.extraPrice,
      })))
      if (customizations.error) throw customizations.error
    }
  }

  const placed = await client.rpc('place_order', {
    p_cart_id: cartId,
    p_pickup_slot_id: pickupSlotId,
    p_payment_method: 'PAY_AT_COUNTER',
  })
  if (placed.error) throw placed.error
  const orderId = String(placed.data)
  const order = await client.from('orders').select('id, order_number, outlet_id, total, status, outlets(name), pickup_slots(start_time, end_time, slot_date), pickup_tokens(token_value, expires_at), items:order_items(food_name, quantity)').eq('id', orderId).single()
  if (order.error) throw order.error
  return mapOrder(order.data as LiveOrderRow)
}

export async function fetchUserOrders(userId: string, client: SupabaseClient = supabase!) {
  if (!client) return []
  const { data, error } = await client.from('orders').select('id, order_number, outlet_id, total, status, outlets(name), pickup_slots(start_time, end_time, slot_date), pickup_tokens(token_value, expires_at), items:order_items(food_name, quantity)').eq('user_id', userId).order('created_at', { ascending: false }).limit(20)
  if (error) throw error
  return ((data ?? []) as LiveOrderRow[]).map(mapOrder)
}

export function mapOrder(row: LiveOrderRow): CraveOrder {
  const status = String(row.status).toUpperCase()
  const normalizedStatus = status === 'READY' ? 'Ready for pickup' : status === 'PICKED_UP' ? 'Picked up' : status === 'CANCELLED' || status === 'REJECTED' ? 'Cancelled' : status === 'PREPARING' || status === 'ACCEPTED' ? 'Cooking' : 'Queued'
  const slot = row.pickup_slots
  const token = Array.isArray(row.pickup_tokens) ? row.pickup_tokens[0] : row.pickup_tokens
  const outlet = Array.isArray(row.outlets) ? row.outlets[0] : row.outlets
  const pickup = slot?.start_time ? `${formatTime(slot.start_time)}${slot.end_time ? ` – ${formatTime(slot.end_time)}` : ''}` : 'Slot pending'
  return {
    id: row.order_number || row.id,
    backendId: row.id,
    outlet: outlet?.name || row.outlet_name || 'Live outlet',
    itemLabel: (row.items ?? []).map((item) => `${item.food_name} × ${item.quantity}`).join(' · ') || 'Crave order',
    total: Number(row.total),
    status: normalizedStatus,
    pickup,
    counter: 'SRMIST pickup counter',
    pickupToken: token?.token_value || null,
    fulfillmentMode: 'pickup',
  }
}

export function subscribeToOrder(orderId: string, onOrder: (order: CraveOrder) => void, client: SupabaseClient = supabase!) {
  if (!client) return () => undefined
  const channel = client.channel(`crave-order-${orderId}`).on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `id=eq.${orderId}` }, async () => {
    const { data } = await client.from('orders').select('id, order_number, outlet_id, total, status, outlets(name), pickup_slots(start_time, end_time, slot_date), pickup_tokens(token_value, expires_at), items:order_items(food_name, quantity)').eq('id', orderId).maybeSingle()
    if (data) onOrder(mapOrder(data as LiveOrderRow))
  }).subscribe()
  return () => { void client.removeChannel(channel) }
}
