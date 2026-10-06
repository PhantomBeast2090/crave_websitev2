import type { Tone } from '../types'

const tones: Tone[] = ['tangerine', 'chartreuse', 'lavender', 'aqua', 'sun']
const stable = (value: string) => [...value].reduce((sum, ch) => sum + ch.charCodeAt(0), 0)
export const toneFor = (value: string): Tone => tones[stable(value) % tones.length]

export function emojiForFood(name: string, category?: string | null): string {
  const text = `${name} ${category ?? ''}`.toLowerCase()
  const rules: [RegExp, string][] = [
    [/biryani|pulao/, '🍛'], [/roll|shawarma|wrap|kubos/, '🌯'], [/burger/, '🍔'], [/sandwich|club|bread omelet/, '🥪'], [/pizza/, '🍕'],
    [/momo/, '🥟'], [/dosa|idli|uttapam/, '🥞'], [/naan|roti|chapati|parotta|pulk|kulcha|bread/, '🫓'], [/noodle|maggi|pasta/, '🍜'],
    [/rice/, '🍚'], [/samosa|vada|pakoda|fry|fries|snack/, '🍟'], [/egg|omelet|omlette/, '🍳'], [/chicken|mutton|fish|prawn|seafood|tandoori|kabab|kebab/, '🍗'],
    [/gravy|curry|masala|korma|paneer|dal|bhartha|gobi|aloo|bhindi/, '🍲'], [/chat|chaat|salad/, '🥗'], [/juice|shake|lassi|mojito|soda|lime|booster|milk/, '🥤'],
    [/ice cream|kulfi|brownie|cake|caramel|treat/, '🍨'], [/corn/, '🌽'], [/coffee|tea/, '☕'], [/fruit|apple|banana|avocado|blueberry|cherry|carrot|beetroot/, '🍎'],
  ]
  return rules.find(([re]) => re.test(text))?.[1] ?? '🍽️'
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '·'

/** Makes free text safe inside a PostgREST `or=(...)` / ilike filter. */
export const cleanSearch = (value: string) => value.replace(/[%*,()\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)

export const statusLabel = (status: string) => ({
  CREATED: 'Created', PLACED: 'Placed', ACCEPTED: 'Accepted', PREPARING: 'Cooking', READY: 'Ready for pickup', PICKED_UP: 'Picked up',
  REJECTED: 'Rejected', CANCELLED: 'Cancelled', EXPIRED: 'Expired', REFUNDED: 'Refunded',
} as Record<string, string>)[status] ?? status

export const paymentLabel = (status: string, method?: string) => {
  if (status === 'PAID' || status === 'CAPTURED') return method === 'PAY_AT_COUNTER' ? 'Paid at counter' : 'Paid'
  if (status === 'REFUNDED') return 'Refunded'
  if (status === 'FAILED') return 'Payment failed'
  if (method === 'PAY_AT_COUNTER') return 'Pay at counter'
  return 'Awaiting payment'
}
