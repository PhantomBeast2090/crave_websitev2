import { useEffect } from 'react'
import type { Profile } from '../../types'
import { formatMoney } from '../../lib/pricing'
import { CartProvider, useCart } from '../../state/cart'
import { Link, useRouter } from '../../state/router'
import { Shell, type NavItem } from '../../shell/Shell'
import { ProfilePage } from '../shared/Profile'
import { NotFound, WrongArea } from '../shared/NotFound'
import { CartPage } from './Cart'
import { CheckoutPage } from './Checkout'
import { StudentProvider, useStudent } from './context'
import { ExplorePage } from './Explore'
import { FavoritesPage } from './Favorites'
import { FoodPage } from './Food'
import { HomePage } from './Home'
import { OrderDetailPage } from './OrderDetail'
import { OrdersPage, statusTone } from './Orders'
import { OutletPage } from './Outlet'
import { Badge, FoodArt } from '../../ui/kit'
import { statusLabel } from '../../lib/ui-helpers'
import { isUuid } from '../../lib/errors'

const nav: NavItem[] = [
  { label: 'Discover', to: '/', icon: '✦' },
  { label: 'Explore', to: '/explore', icon: '⌕', match: (p) => p.startsWith('/explore') || p.startsWith('/outlet') || p.startsWith('/food') },
  { label: 'My orders', to: '/orders', icon: '↗' },
  { label: 'Saved bites', to: '/favorites', icon: '♡' },
  { label: 'Bag', to: '/cart', icon: '◉', match: (p) => p === '/cart' || p === '/checkout' },
]

function CartRail() {
  const cart = useCart()
  const { activeOrder } = useStudent()
  return <aside className="cart-rail" aria-label="Bag and current order">
    <div className="rail-top"><span className="eyebrow">QUICK LOOK</span></div>
    {cart.count > 0 ? <div className="rail-cart"><div className="rail-heading"><h2>Your bag <span>{cart.count}</span></h2><Link className="text-button" to="/cart">edit <span aria-hidden="true">↗</span></Link></div>
      {cart.lines.slice(0, 3).map((l) => <div className="rail-item" key={l.key}><FoodArt item={l} className="rail-item-emoji" /><div><strong>{l.name}</strong><small>{l.quantity} × {formatMoney(l.price + l.options.reduce((s, o) => s + o.extraPrice, 0))}</small></div></div>)}
      {cart.lines.length > 3 && <small className="more-items">+ {cart.lines.length - 3} more</small>}
      <div className="rail-total"><span>Subtotal</span><strong>{formatMoney(cart.totals.subtotal)}</strong></div>
      <Link to="/checkout" className="button button-primary full-button">Checkout <span aria-hidden="true">↗</span></Link></div>
      : <div className="rail-empty"><div className="empty-doodle" aria-hidden="true">✦</div><h2>Bag’s empty,<br /><em>mind’s busy?</em></h2><Link className="text-button" to="/explore">find a bite <span aria-hidden="true">↗</span></Link></div>}
    <div className="rail-divider" />
    {activeOrder ? <div className="rail-order"><div className="rail-heading"><div><span className="eyebrow">IN PROGRESS</span><h2>Current order</h2></div></div>
      <p>{activeOrder.outletName}</p><p><Badge tone={statusTone(activeOrder.status)}>{statusLabel(activeOrder.status)}</Badge></p><Link className="text-button" to={`/orders/${activeOrder.id}`}>track it <span aria-hidden="true">↗</span></Link></div>
      : <p className="muted" style={{ fontSize: 12 }}>No active orders.</p>}
  </aside>
}

function StudentRoutes() {
  const { segments, navigate } = useRouter()
  const [area, id] = segments
  useEffect(() => { if (area === 'menu' && id) navigate(`/outlet/${id}`, { replace: true }) }, [area, id, navigate])   // legacy URL
  if (!area) return <HomePage />
  if (['vendor', 'admin'].includes(area)) return <WrongArea />
  switch (area) {
    case 'explore': return <ExplorePage />
    case 'outlet': return isUuid(id) ? <OutletPage id={id} /> : <NotFound />
    case 'menu': return null
    case 'food': return isUuid(id) ? <FoodPage id={id} /> : <NotFound />
    case 'cart': return <CartPage />
    case 'checkout': return <CheckoutPage />
    case 'orders': return id ? (isUuid(id) ? <OrderDetailPage id={id} /> : <NotFound />) : <OrdersPage />
    case 'favorites': return <FavoritesPage />
    case 'profile': return <ProfilePage />
    default: return <NotFound />
  }
}

export function StudentApp({ profile }: { profile: Profile }) {
  return <CartProvider userId={profile.id}><StudentProvider userId={profile.id}>
    <Shell profile={profile} nav={nav} home="/" rail={<CartRail />} searchable><StudentRoutes /></Shell>
  </StudentProvider></CartProvider>
}
