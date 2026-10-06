import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { CustomizationOption, Food, Order } from '../../types'
import { fetchFavoriteIds, setFavorite } from '../../lib/api/catalog'
import { fetchMyOrders, subscribeToOrders } from '../../lib/api/orders'
import { friendlyError, logError } from '../../lib/errors'
import { useCart } from '../../state/cart'
import { useToast } from '../../state/toast'
import { Dialog } from '../../ui/kit'
import { useRouter } from '../../state/router'

type StudentCtx = {
  favorites: Set<string>
  toggleFavorite: (foodId: string) => void
  requestAdd: (food: Food, quantity: number, options?: CustomizationOption[], note?: string, goToBag?: boolean) => void
  activeOrder: Order | null
  refreshOrders: () => void
}
const Ctx = createContext<StudentCtx | null>(null)

export function StudentProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const toast = useToast()
  const cart = useCart()
  const { navigate } = useRouter()
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [activeOrder, setActiveOrder] = useState<Order | null>(null)
  const [pending, setPending] = useState<{ food: Food; quantity: number; options?: CustomizationOption[]; note?: string; goToBag?: boolean } | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => { setFavorites(new Set()); void fetchFavoriteIds(userId).then((ids) => setFavorites(new Set(ids))).catch((e) => logError('favorites', e)) }, [userId])

  useEffect(() => {
    let alive = true
    fetchMyOrders(userId, 5).then((orders) => { if (alive) setActiveOrder(orders.find((o) => ['PLACED', 'ACCEPTED', 'PREPARING', 'READY'].includes(o.status)) ?? null) }).catch((e) => logError('active-order', e))
    return () => { alive = false }
  }, [userId, tick])
  useEffect(() => subscribeToOrders(() => setTick((t) => t + 1)), [])

  const toggleFavorite = useCallback((foodId: string) => {
    setFavorites((current) => {
      const next = new Set(current); const adding = !next.has(foodId)
      adding ? next.add(foodId) : next.delete(foodId)
      setFavorite(userId, foodId, adding).catch((error) => {
        logError('favorite', error)
        setFavorites((now) => { const undo = new Set(now); adding ? undo.delete(foodId) : undo.add(foodId); return undo })
        toast.show(friendlyError(error, 'Could not update your saved bites.'), 'red')
      })
      return next
    })
  }, [userId, toast])

  const addNow = useCallback((food: Food, quantity: number, options?: CustomizationOption[], note?: string, goToBag?: boolean) => {
    const result = cart.add(food, quantity, options, note)
    if (result === 'limit') toast.show('You can add up to 20 of one item (30 lines per bag).', 'red')
    else if (result === 'added') { toast.show(`${food.name} is in your bag`, 'green'); if (goToBag) navigate('/cart') }
    return result
  }, [cart, toast, navigate])

  const requestAdd: StudentCtx['requestAdd'] = useCallback((food, quantity, options, note, goToBag) => {
    if (!food.isAvailable || food.stock === 0) return toast.show(`${food.name} is sold out right now.`, 'red')
    if (addNow(food, quantity, options, note, goToBag) === 'other-outlet') setPending({ food, quantity, options, note, goToBag })
  }, [addNow, toast])

  return <Ctx.Provider value={{ favorites, toggleFavorite, requestAdd, activeOrder, refreshOrders: () => setTick((t) => t + 1) }}>
    {children}
    {pending && <Dialog title="Start a new bag?" onClose={() => setPending(null)} actions={<>
      <button type="button" className="button button-light" onClick={() => setPending(null)}>Keep my bag</button>
      <button type="button" className="button button-primary" onClick={() => { cart.clear(); const p = pending; setPending(null); addNow(p.food, p.quantity, p.options, p.note, p.goToBag) }}>Start new bag</button></>}>
      <p>One order can only come from one outlet. Your bag has items from <strong>{cart.lines[0]?.outletName ?? 'another outlet'}</strong>. Starting a new bag from <strong>{pending.food.outletName}</strong> will empty it.</p>
    </Dialog>}
  </Ctx.Provider>
}

export function useStudent() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useStudent must be used inside StudentProvider')
  return ctx
}
