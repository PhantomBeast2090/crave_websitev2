export type Tone = 'tangerine' | 'chartreuse' | 'lavender' | 'aqua' | 'sun'

export type CustomizationOption = {
  id: string
  variantId: string
  variantName: string
  name: string
  extraPrice: number
}

export type CustomizationGroup = {
  id: string
  name: string
  isRequired: boolean
  maxSelections: number
  options: CustomizationOption[]
}

export type Category = {
  id: string
  label: string
  emoji: string
}

export type Food = {
  id: string
  outletId: string
  name: string
  description: string
  category: string
  price: number
  rating: number
  prep: string
  emoji: string
  tone: Tone
  imageUrl?: string | null
  isVeg?: boolean
  tag?: string
  popular?: boolean
  customizations?: string[]
  customizationGroups?: CustomizationGroup[]
}

export type Outlet = {
  id: string
  name: string
  location: string
  eta: string
  rating: number
  orders: string
  emoji: string
  tone: Tone
  open: boolean
  vibe: string
  imageUrl?: string | null
  vendorId?: string | null
}

export type CartItem = Food & {
  quantity: number
  note?: string
  customizations?: string[]
  selectedOptions?: CustomizationOption[]
  customizationTotal?: number
}

export type OrderStatus = 'Queued' | 'Cooking' | 'Ready for pickup' | 'Picked up' | 'Cancelled'

export type CraveOrder = {
  id: string
  backendId?: string
  pickupToken?: string | null
  outlet: string
  itemLabel: string
  total: number
  status: OrderStatus
  pickup: string
  counter: string
  fulfillmentMode: 'pickup' | 'delivery'
}

export const categories: Category[] = [
  { id: 'all', label: 'Everything', emoji: '✦' },
  { id: 'quick-bites', label: 'Quick bites', emoji: '⚡' },
  { id: 'comfort', label: 'Comfort', emoji: '♡' },
  { id: 'drinks', label: 'Drinks', emoji: '◉' },
  { id: 'sweet', label: 'Sweet stuff', emoji: '✺' },
]

export const outlets: Outlet[] = [
  { id: 'nosh', name: 'Nosh Lab', location: 'Tech Park • Ground floor', eta: '12–18 min', rating: 4.8, orders: '1.2k orders', emoji: '🥪', tone: 'tangerine', open: true, vibe: 'sandwiches with main-character energy' },
  { id: 'dosa', name: 'Dosa District', location: 'Food Court • Stall 04', eta: '18–24 min', rating: 4.7, orders: '890 orders', emoji: '🥞', tone: 'chartreuse', open: true, vibe: 'crispy edges, no boring fillings' },
  { id: 'bowl', name: 'Bowl Movement', location: 'UB • Next to the fountain', eta: '10–15 min', rating: 4.6, orders: '742 orders', emoji: '🥗', tone: 'aqua', open: true, vibe: 'fresh bowls for deadline season' },
  { id: 'sweet', name: 'Sugar Rush', location: 'Library lane • Kiosk 2', eta: '8–12 min', rating: 4.9, orders: '1.6k orders', emoji: '🍩', tone: 'lavender', open: true, vibe: 'tiny desserts, huge serotonin' },
  { id: 'chai', name: 'Chai Theory', location: 'Hostel H • Courtyard', eta: '15–20 min', rating: 4.5, orders: '610 orders', emoji: '🫖', tone: 'sun', open: false, vibe: 'slow sips and loud gossip' },
]

export const foods: Food[] = [
  { id: 'peri-peri-paneer', outletId: 'nosh', name: 'Peri Peri Paneer Melt', description: 'Toasted sourdough, gooey paneer, crunchy slaw, secret red sauce.', category: 'quick-bites', price: 149, rating: 4.9, prep: '12 min', emoji: '🥪', tone: 'tangerine', tag: 'campus fave', popular: true, customizations: ['Extra cheese', 'Add jalapeños', 'Make it a combo'] },
  { id: 'miso-noodle-bowl', outletId: 'bowl', name: 'Miso Crunch Bowl', description: 'Sesame noodles, roasted corn, edamame, chilli crisp and a soft egg.', category: 'comfort', price: 189, rating: 4.8, prep: '14 min', emoji: '🍜', tone: 'aqua', tag: 'new', popular: true, customizations: ['Add tofu', 'Extra chilli crisp', 'No egg'] },
  { id: 'loaded-fries', outletId: 'nosh', name: 'Loaded Campus Fries', description: 'Shoestring fries, tangy cheese sauce, corn salsa, and a little chaos.', category: 'quick-bites', price: 119, rating: 4.7, prep: '10 min', emoji: '🍟', tone: 'sun', tag: 'late night', popular: true, customizations: ['Extra sauce', 'Add paneer', 'Make it spicy'] },
  { id: 'masala-dosa', outletId: 'dosa', name: 'Masala Dosa Remix', description: 'Crispy dosa with potato masala, gunpowder podi, and three chutneys.', category: 'comfort', price: 99, rating: 4.8, prep: '18 min', emoji: '🥞', tone: 'chartreuse', tag: 'classic', popular: true, customizations: ['Extra podi', 'Add cheese', 'Chutney flight'] },
  { id: 'mango-matcha', outletId: 'bowl', name: 'Mango Matcha Cloud', description: 'Iced matcha, mango foam, coconut jelly, sunshine in a cup.', category: 'drinks', price: 129, rating: 4.6, prep: '8 min', emoji: '🥭', tone: 'chartreuse', tag: 'fresh drop', customizations: ['Less sweet', 'Extra jelly', 'Oat milk'] },
  { id: 'brownie-skillet', outletId: 'sweet', name: 'Midnight Brownie Skillet', description: 'Warm fudgy brownie, vanilla ice cream, and absolutely no regrets.', category: 'sweet', price: 159, rating: 4.9, prep: '12 min', emoji: '🍫', tone: 'lavender', tag: 'study snack', customizations: ['Extra ice cream', 'Add hazelnut', 'No nuts'] },
  { id: 'tandoori-roll', outletId: 'nosh', name: 'Tandoori Crunch Roll', description: 'Smoky filling, pickled onions, mint mayo, wrapped up tight.', category: 'quick-bites', price: 129, rating: 4.7, prep: '11 min', emoji: '🌯', tone: 'tangerine', customizations: ['Extra mint mayo', 'Add cheese', 'No onions'] },
  { id: 'filter-kaapi', outletId: 'chai', name: 'Filter Kaapi Float', description: 'Strong South Indian coffee with a cold cream float.', category: 'drinks', price: 89, rating: 4.5, prep: '8 min', emoji: '☕', tone: 'sun', tag: 'cozy', customizations: ['Less sugar', 'Extra strong', 'Cold only'] },
]

export const demoOrder: CraveOrder = {
  id: 'CRV-4821',
  outlet: 'Nosh Lab',
  itemLabel: 'Peri Peri Paneer Melt × 1',
  total: 175,
  status: 'Cooking' as OrderStatus,
  pickup: '12:40 – 12:55 PM',
  counter: 'Nosh Lab • Tech Park ground floor',
  fulfillmentMode: 'pickup' as 'pickup' | 'delivery',
}

export const pastOrders = [
  { id: 'CRV-4773', outlet: 'Dosa District', itemLabel: 'Masala Dosa Remix × 2', total: 198, date: 'Yesterday', status: 'Picked up' },
  { id: 'CRV-4690', outlet: 'Bowl Movement', itemLabel: 'Miso Crunch Bowl × 1', total: 189, date: 'Sep 30', status: 'Picked up' },
]

export const initialFavorites = ['peri-peri-paneer', 'brownie-skillet', 'mango-matcha']

export function getOutlet(id: string) {
  return outlets.find((outlet) => outlet.id === id)
}

export function getFood(id: string) {
  return foods.find((food) => food.id === id)
}

export function getCustomizationPrice(item: string) {
  if (item.includes('combo')) return 40
  if (item.includes('cheese') || item.includes('tofu')) return 20
  return 0
}
