import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { CartLine, CustomizationOption, Food } from '../types'
import { MAX_LINE_QUANTITY, orderTotals } from '../lib/pricing'

type AddResult = 'added' | 'other-outlet' | 'limit'
type CartApi = {
  lines: CartLine[]
  count: number
  totals: { subtotal: number; tax: number; total: number }
  outletId: string | null
  add: (food: Food, quantity: number, options?: CustomizationOption[], note?: string) => AddResult
  setQuantity: (key: string, quantity: number) => void
  replaceLines: (lines: CartLine[]) => void
  clear: () => void
}
const CartContext = createContext<CartApi | null>(null)
const storageKey = (userId: string) => `crave.cart.v1.${userId}`

function readStored(userId: string): CartLine[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey(userId)) ?? '[]')
    if (!Array.isArray(parsed)) return []
    // The cart only remembers WHAT was chosen. Prices are display hints and are re-read from the server before every checkout.
    return parsed.filter((l) => l && typeof l.key === 'string' && typeof l.foodId === 'string' && typeof l.outletId === 'string' && Number.isInteger(l.quantity) && l.quantity > 0 && l.quantity <= MAX_LINE_QUANTITY && Number.isFinite(l.price)).slice(0, 30)
  } catch { return [] }
}

const lineKey = (foodId: string, options: CustomizationOption[], note?: string) => `${foodId}|${options.map((o) => o.id).sort().join(',')}|${(note ?? '').trim()}`

export function CartProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(() => readStored(userId))

  // A different signed-in user must never inherit the previous user's bag.
  useEffect(() => { setLines(readStored(userId)) }, [userId])
  useEffect(() => { try { window.localStorage.setItem(storageKey(userId), JSON.stringify(lines)) } catch { /* storage unavailable: cart still works in memory */ } }, [lines, userId])

  const add = useCallback<CartApi['add']>((food, quantity, options = [], note) => {
    let result: AddResult = 'added'
    setLines((current) => {
      if (current.length && current[0].outletId !== food.outletId) { result = 'other-outlet'; return current }
      const key = lineKey(food.id, options, note)
      const existing = current.find((line) => line.key === key)
      if (existing) {
        if (existing.quantity + quantity > MAX_LINE_QUANTITY) { result = 'limit'; return current }
        return current.map((line) => line.key === key ? { ...line, quantity: line.quantity + quantity } : line)
      }
      if (quantity > MAX_LINE_QUANTITY || current.length >= 30) { result = 'limit'; return current }
      return [...current, { key, foodId: food.id, outletId: food.outletId, outletName: food.outletName, name: food.name, emoji: food.emoji, tone: food.tone, imageUrl: food.imageUrl, isVeg: food.isVeg, price: food.price, quantity, options, note: note?.trim() || undefined }]
    })
    return result
  }, [])

  const setQuantity = useCallback((key: string, quantity: number) => {
    setLines((current) => quantity <= 0 ? current.filter((line) => line.key !== key) : current.map((line) => line.key === key ? { ...line, quantity: Math.min(quantity, MAX_LINE_QUANTITY) } : line))
  }, [])

  const value = useMemo<CartApi>(() => ({
    lines, count: lines.reduce((sum, line) => sum + line.quantity, 0), totals: orderTotals(lines), outletId: lines[0]?.outletId ?? null,
    add, setQuantity, replaceLines: setLines, clear: () => setLines([]),
  }), [lines, add, setQuantity])
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used inside CartProvider')
  return ctx
}
