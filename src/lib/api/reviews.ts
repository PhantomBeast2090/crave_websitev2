import { supabase } from '../supabase'

function db() {
  if (!supabase) throw new Error('Crave is not configured for this environment.')
  return supabase
}

export const REVIEW_MAX = 1000

export type Reply = { id?: string; text: string; createdAt?: string }
export type Review = {
  id: string; rating: number; text: string; createdAt: string
  reviewer?: string; isVisible?: boolean; mine?: boolean
  foodId?: string; foodName?: string; outletId?: string; outletName?: string
  orderItemId?: string; orderId?: string
  reply?: Reply | null
}
export type ReviewPage = { total: number; reviews: Review[] }

type Row = Record<string, any>
const pick = (row: Row, ...keys: string[]) => { for (const key of keys) if (row[key] !== undefined && row[key] !== null) return row[key]; return undefined }

/** Tolerant mapper: the food-review RPCs were built by the Android backend and may name fields differently. */
export function mapReview(row: Row): Review {
  const replyRow = (Array.isArray(row.review_replies) ? row.review_replies[0] : row.review_replies) ?? row.vendor_reply ?? row.reply ?? null
  const replyText = replyRow?.reply_text ?? replyRow?.text ?? (typeof row.reply_text === 'string' ? row.reply_text : undefined)
  return {
    id: String(row.id), rating: Number(row.rating), text: String(pick(row, 'review_text', 'comment', 'text') ?? ''),
    createdAt: String(pick(row, 'created_at', 'updated_at') ?? ''),
    reviewer: pick(row, 'reviewer_name', 'student_name', 'user_name', 'author_name'),
    isVisible: row.is_visible, mine: row.is_mine,
    foodId: pick(row, 'food_item_id', 'food_id'), foodName: pick(row, 'food_name', 'food_item_name'),
    outletId: row.outlet_id, outletName: pick(row, 'outlet_name'),
    orderItemId: row.order_item_id, orderId: row.order_id,
    reply: replyText ? { id: replyRow?.id, text: replyText, createdAt: replyRow?.created_at ?? row.replied_at } : null,
  }
}

const mapPage = (data: Row | null): ReviewPage => ({ total: Number(data?.total ?? 0), reviews: ((data?.reviews ?? []) as Row[]).map(mapReview) })

// ---- Student: food reviews -------------------------------------------------------------------
export async function fetchFoodReviews(foodId: string, page = 0, pageSize = 10): Promise<ReviewPage> {
  const { data, error } = await db().rpc('get_food_reviews', { p_food_item_id: foodId, p_limit: pageSize, p_offset: page * pageSize })
  if (error) throw error
  return mapPage(data)
}

export async function fetchMyFoodReviews(orderId: string): Promise<Map<string, Review>> {
  const { data, error } = await db().from('reviews').select('id,rating,review_text,created_at,order_item_id,food_item_id,is_visible,review_replies(id,reply_text,created_at)').eq('order_id', orderId)
  if (error) throw error
  return new Map((data ?? []).filter((row) => row.order_item_id).map((row) => [row.order_item_id as string, mapReview(row)]))
}

export async function saveFoodReview(input: { userId: string; orderId: string; orderItemId: string; foodId: string; rating: number; text: string; existingId?: string }) {
  const text = input.text.trim().slice(0, REVIEW_MAX) || null
  const result = input.existingId
    ? await db().from('reviews').update({ rating: input.rating, review_text: text }).eq('id', input.existingId)
    : await db().from('reviews').insert({ student_id: input.userId, order_id: input.orderId, order_item_id: input.orderItemId, food_item_id: input.foodId, rating: input.rating, review_text: text })
  if (result.error) throw result.error
}

export async function deleteFoodReview(id: string) {
  const { error } = await db().from('reviews').delete().eq('id', id)
  if (error) throw error
}

// ---- Student: outlet reviews -----------------------------------------------------------------
export async function fetchOutletReviews(outletId: string, page = 0, pageSize = 10): Promise<ReviewPage> {
  const { data, error } = await db().rpc('get_outlet_reviews', { p_outlet_id: outletId, p_limit: pageSize, p_offset: page * pageSize })
  if (error) throw error
  return mapPage(data)
}

export async function fetchMyOutletReview(orderId: string): Promise<Review | null> {
  const { data, error } = await db().from('outlet_reviews').select('id,rating,review_text,created_at,order_id,is_visible,outlet_review_replies(id,reply_text,created_at)').eq('order_id', orderId).maybeSingle()
  if (error) throw error
  if (!data) return null
  const mapped = mapReview({ ...data, review_replies: data.outlet_review_replies })
  return mapped
}

export async function saveOutletReview(input: { userId: string; orderId: string; outletId: string; rating: number; text: string; existingId?: string }) {
  const text = input.text.trim().slice(0, REVIEW_MAX) || null
  const result = input.existingId
    ? await db().from('outlet_reviews').update({ rating: input.rating, review_text: text }).eq('id', input.existingId)
    : await db().from('outlet_reviews').insert({ student_id: input.userId, order_id: input.orderId, outlet_id: input.outletId, rating: input.rating, review_text: text })
  if (result.error) throw result.error
}

export async function deleteOutletReview(id: string) {
  const { error } = await db().from('outlet_reviews').delete().eq('id', id)
  if (error) throw error
}

// ---- Vendor ----------------------------------------------------------------------------------
export async function fetchVendorFoodReviews(page = 0, pageSize = 20): Promise<ReviewPage> {
  const { data, error } = await db().rpc('get_vendor_reviews', { p_limit: pageSize, p_offset: page * pageSize })
  if (error) throw error
  return mapPage(data)
}

export async function fetchVendorOutletReviews(outletId: string | null, page = 0, pageSize = 20): Promise<ReviewPage> {
  const { data, error } = await db().rpc('get_vendor_outlet_reviews', { p_outlet_id: outletId, p_limit: pageSize, p_offset: page * pageSize })
  if (error) throw error
  return mapPage(data)
}

export async function saveFoodReply(input: { reviewId: string; vendorId: string; text: string; existingId?: string }) {
  const text = input.text.trim()
  if (!text || text.length > REVIEW_MAX) throw new Error(`Reply must be between 1 and ${REVIEW_MAX} characters.`)
  const result = input.existingId
    ? await db().from('review_replies').update({ reply_text: text }).eq('id', input.existingId)
    : await db().from('review_replies').insert({ review_id: input.reviewId, vendor_id: input.vendorId, reply_text: text })
  if (result.error) throw result.error
}

export async function deleteFoodReply(id: string) {
  const { error } = await db().from('review_replies').delete().eq('id', id)
  if (error) throw error
}

export async function saveOutletReply(input: { reviewId: string; vendorId: string; text: string; existingId?: string }) {
  const text = input.text.trim()
  if (!text || text.length > REVIEW_MAX) throw new Error(`Reply must be between 1 and ${REVIEW_MAX} characters.`)
  const result = input.existingId
    ? await db().from('outlet_review_replies').update({ reply_text: text }).eq('id', input.existingId)
    : await db().from('outlet_review_replies').insert({ review_id: input.reviewId, vendor_id: input.vendorId, reply_text: text })
  if (result.error) throw result.error
}

export async function deleteOutletReply(id: string) {
  const { error } = await db().from('outlet_review_replies').delete().eq('id', id)
  if (error) throw error
}

// ---- Management ------------------------------------------------------------------------------
export type ModerationFilter = { search?: string; visibility?: 'all' | 'visible' | 'hidden'; rating?: number | null; outletId?: string | null; page?: number; pageSize?: number }

export async function adminSearchFoodReviews(filter: ModerationFilter): Promise<ReviewPage> {
  const { data, error } = await db().rpc('admin_search_food_reviews', {
    p_search: filter.search?.trim() || null, p_visibility: filter.visibility ?? 'all', p_rating: filter.rating ?? null,
    p_limit: filter.pageSize ?? 20, p_offset: (filter.page ?? 0) * (filter.pageSize ?? 20),
  })
  if (error) throw error
  return mapPage(data)
}

export async function adminSearchOutletReviews(filter: ModerationFilter): Promise<ReviewPage> {
  const { data, error } = await db().rpc('admin_search_outlet_reviews', {
    p_search: filter.search?.trim() || null, p_visibility: filter.visibility ?? 'all', p_outlet_id: filter.outletId ?? null, p_rating: filter.rating ?? null,
    p_limit: filter.pageSize ?? 20, p_offset: (filter.page ?? 0) * (filter.pageSize ?? 20),
  })
  if (error) throw error
  return mapPage(data)
}

export async function setFoodReviewVisibility(id: string, visible: boolean) {
  const { error } = await db().rpc('admin_set_food_review_visibility', { p_review_id: id, p_visible: visible })
  if (error) throw error
}

export async function setOutletReviewVisibility(id: string, visible: boolean) {
  const { error } = await db().rpc('admin_set_outlet_review_visibility', { p_review_id: id, p_visible: visible })
  if (error) throw error
}
