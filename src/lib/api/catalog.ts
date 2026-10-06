import type { Category, CustomizationGroup, Food, Outlet } from '../../types'
import { supabase } from '../supabase'
import { cleanSearch, emojiForFood, toneFor } from '../ui-helpers'
import { formatTime12 } from '../time'

function db() {
  if (!supabase) throw new Error('Crave is not configured for this environment.')
  return supabase
}

type OutletRow = {
  id: string; name: string; description?: string | null; image_url?: string | null; vendor_id?: string | null; is_open?: boolean | null
  building?: string | null; floor?: string | null; location_description?: string | null; rating?: number | null; total_reviews?: number | null
  operating_hours?: { openTime?: string; closeTime?: string } | null
}
const OUTLET_COLUMNS = 'id,name,description,image_url,vendor_id,is_open,building,floor,location_description,rating,total_reviews,operating_hours'

export function mapOutlet(row: OutletRow): Outlet {
  return {
    id: row.id,
    name: row.name,
    location: [row.building, row.floor].filter(Boolean).join(' · ') || row.location_description || 'SRMIST campus',
    rating: Number(row.rating ?? 0),
    reviewCount: row.total_reviews ?? 0,
    emoji: emojiForFood(row.name),
    tone: toneFor(row.id),
    isOpen: Boolean(row.is_open),
    description: row.description || 'Campus food, ready when you are.',
    imageUrl: row.image_url,
    vendorId: row.vendor_id,
    opensAt: row.operating_hours?.openTime && formatTime12(row.operating_hours.openTime),
    closesAt: row.operating_hours?.closeTime && formatTime12(row.operating_hours.closeTime),
  }
}

type FoodRow = {
  id: string; outlet_id: string; category_id: string; name: string; description?: string | null; image_url?: string | null; price: number
  is_veg?: boolean | null; is_available?: boolean | null; prep_time_minutes?: number | null; rating?: number | null; total_reviews?: number | null
  tags?: string[] | null; is_popular?: boolean | null
  outlets?: { name: string } | null; categories?: { name: string; emoji?: string | null } | null
  inventory?: { quantity_available: number } | { quantity_available: number }[] | null
  food_variants?: { id: string; name: string; is_required?: boolean | null; max_selections?: number | null; food_variant_options?: { id: string; name: string; extra_price?: number | null }[] | null }[] | null
}
const FOOD_BASE = 'id,outlet_id,category_id,name,description,image_url,price,is_veg,is_available,prep_time_minutes,rating,total_reviews,tags,is_popular,outlets(name),categories(name,emoji),inventory(quantity_available)'
// Variants are always fetched so a card knows whether it can be added without choices.
const FOOD_COLUMNS = `${FOOD_BASE},food_variants(id,name,is_required,max_selections,food_variant_options(id,name,extra_price))`
const FOOD_WITH_VARIANTS = FOOD_COLUMNS

export function mapFood(row: FoodRow): Food {
  const inventory = Array.isArray(row.inventory) ? row.inventory[0] : row.inventory
  const quantity = inventory?.quantity_available
  const groups: CustomizationGroup[] = (row.food_variants ?? []).map((variant) => ({
    id: variant.id, name: variant.name, isRequired: Boolean(variant.is_required), maxSelections: variant.max_selections ?? 1,
    options: (variant.food_variant_options ?? []).map((option) => ({ id: option.id, variantId: variant.id, variantName: variant.name, name: option.name, extraPrice: Number(option.extra_price ?? 0) })),
  }))
  return {
    id: row.id, outletId: row.outlet_id, outletName: row.outlets?.name, name: row.name,
    description: row.description || 'A campus classic, ready when you are.',
    categoryId: row.category_id, categoryName: row.categories?.name, price: Number(row.price),
    rating: Number(row.rating ?? 0), reviewCount: row.total_reviews ?? 0, prepMinutes: row.prep_time_minutes ?? 10,
    emoji: emojiForFood(row.name, row.categories?.name), tone: toneFor(row.id), imageUrl: row.image_url,
    isVeg: row.is_veg ?? true, isAvailable: Boolean(row.is_available),
    tag: row.tags?.[0] || (row.is_popular ? 'campus fave' : undefined), popular: Boolean(row.is_popular),
    stock: typeof quantity === 'number' ? quantity : null, groups,
  }
}

export async function fetchOutlets(): Promise<Outlet[]> {
  const { data, error } = await db().from('outlets').select(OUTLET_COLUMNS).eq('is_active', true).is('deleted_at', null).order('name')
  if (error) throw error
  return (data as OutletRow[]).map(mapOutlet)
}

export async function fetchOutlet(id: string): Promise<Outlet | null> {
  const { data, error } = await db().from('outlets').select(OUTLET_COLUMNS).eq('id', id).eq('is_active', true).is('deleted_at', null).maybeSingle()
  if (error) throw error
  return data ? mapOutlet(data as OutletRow) : null
}

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await db().from('categories').select('id,name,emoji').order('name')
  if (error) throw error
  return (data ?? []).map((row) => ({ id: row.id as string, label: row.name as string, emoji: (row.emoji as string) || '✦' }))
}

export type FoodSort = 'popular' | 'rating' | 'price_asc' | 'price_desc' | 'name'
export type FoodQuery = {
  search?: string; categoryId?: string; outletId?: string; veg?: boolean | null; maxPrice?: number | null
  sort?: FoodSort; page?: number; pageSize?: number; popularOnly?: boolean
}

/** Server-side filtering, sorting and pagination (the catalogue has 1,400+ items). */
export async function fetchFoods(query: FoodQuery = {}): Promise<{ foods: Food[]; total: number }> {
  const pageSize = Math.min(query.pageSize ?? 24, 60)
  const page = Math.max(query.page ?? 0, 0)
  let request = db().from('food_items').select(FOOD_COLUMNS, { count: 'exact' }).eq('is_available', true).is('deleted_at', null)
  const search = cleanSearch(query.search ?? '')
  if (search) request = request.or(`name.ilike.*${search}*,description.ilike.*${search}*`)
  if (query.categoryId) request = request.eq('category_id', query.categoryId)
  if (query.outletId) request = request.eq('outlet_id', query.outletId)
  if (query.veg === true || query.veg === false) request = request.eq('is_veg', query.veg)
  if (query.maxPrice) request = request.lte('price', query.maxPrice)
  if (query.popularOnly) request = request.eq('is_popular', true)
  switch (query.sort ?? 'popular') {
    case 'rating': request = request.order('rating', { ascending: false }).order('name'); break
    case 'price_asc': request = request.order('price', { ascending: true }).order('name'); break
    case 'price_desc': request = request.order('price', { ascending: false }).order('name'); break
    case 'name': request = request.order('name'); break
    default: request = request.order('is_popular', { ascending: false }).order('rating', { ascending: false }).order('name')
  }
  const { data, error, count } = await request.range(page * pageSize, page * pageSize + pageSize - 1)
  if (error) throw error
  return { foods: (data as unknown as FoodRow[]).map(mapFood), total: count ?? 0 }
}

export async function fetchFood(id: string): Promise<Food | null> {
  const { data, error } = await db().from('food_items').select(FOOD_WITH_VARIANTS).eq('id', id).eq('is_available', true).is('deleted_at', null).maybeSingle()
  if (error) throw error
  return data ? mapFood(data as unknown as FoodRow) : null
}

/** Fresh server truth for cart lines (price, availability, stock, variants). Missing ids = no longer sold. */
export async function fetchFoodsByIds(ids: string[]): Promise<Map<string, Food>> {
  const unique = [...new Set(ids)]
  if (!unique.length) return new Map()
  const { data, error } = await db().from('food_items').select(FOOD_WITH_VARIANTS).in('id', unique).eq('is_available', true).is('deleted_at', null)
  if (error) throw error
  return new Map((data as unknown as FoodRow[]).map((row) => [row.id, mapFood(row)]))
}

export async function fetchFavoriteIds(userId: string): Promise<string[]> {
  const { data, error } = await db().from('favorites').select('food_item_id').eq('user_id', userId)
  if (error) throw error
  return (data ?? []).map((row) => row.food_item_id as string)
}

export async function fetchFavoriteFoods(userId: string): Promise<Food[]> {
  const ids = await fetchFavoriteIds(userId)
  return [...(await fetchFoodsByIds(ids)).values()]
}

export async function setFavorite(userId: string, foodId: string, favorite: boolean) {
  const client = db()
  const result = favorite
    ? await client.from('favorites').upsert({ user_id: userId, food_item_id: foodId }, { onConflict: 'user_id,food_item_id', ignoreDuplicates: true })
    : await client.from('favorites').delete().eq('user_id', userId).eq('food_item_id', foodId)
  if (result.error) throw result.error
}
