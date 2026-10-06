import { useEffect, useState } from 'react'
import { fetchMyOrders, subscribeToOrders } from '../../lib/api/orders'
import { fetchFoodsByIds } from '../../lib/api/catalog'
import { formatMoney } from '../../lib/pricing'
import { dayLabel, formatDateTime, formatTime12 } from '../../lib/time'
import { paymentLabel, statusLabel } from '../../lib/ui-helpers'
import type { Order } from '../../types'
import { useReadyAuth } from '../../state/auth'
import { useCart } from '../../state/cart'
import { Link, useRouter } from '../../state/router'
import { useToast } from '../../state/toast'
import { useAsync } from '../../state/useAsync'
import { Badge, EmptyState, ErrorState, Page, PageHeading, Skeleton, Tabs } from '../../ui/kit'

const ACTIVE = ['CREATED', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY']
export const statusTone = (s: string) => s === 'READY' ? 'green' : s === 'PICKED_UP' ? 'ink' : ['CANCELLED', 'REJECTED', 'EXPIRED'].includes(s) ? 'red' : s === 'PLACED' ? 'orange' : 'blue'

export function OrderStatusBadges({ order }: { order: Order }) {
  const unpaidOnline = order.paymentMethod === 'ONLINE' && !['PAID', 'CAPTURED', 'REFUNDED'].includes(order.paymentStatus) && ACTIVE.includes(order.status)
  return <span className="row"><Badge tone={statusTone(order.status)}>{statusLabel(order.status)}</Badge><Badge tone={unpaidOnline ? 'orange' : order.paymentStatus === 'FAILED' ? 'red' : 'neutral'}>{paymentLabel(order.paymentStatus, order.paymentMethod)}</Badge></span>
}

export const slotText = (o: Order) => o.slotDate && o.slotStart ? `${dayLabel(o.slotDate)} · ${formatTime12(o.slotStart)}${o.slotEnd ? ` – ${formatTime12(o.slotEnd)}` : ''}` : 'Slot pending'

export function OrdersPage() {
  const { session } = useReadyAuth()
  const cart = useCart()
  const toast = useToast()
  const { navigate } = useRouter()
  const [tab, setTab] = useState<'active' | 'past'>('active')
  const orders = useAsync(() => fetchMyOrders(session.user.id), [session.user.id])
  useEffect(() => subscribeToOrders(orders.reload), [orders.reload])   // eslint-disable-line react-hooks/exhaustive-deps

  const list = (orders.data ?? []).filter((o) => (tab === 'active') === ACTIVE.includes(o.status))
  const reorder = async (order: Order) => {
    try {
      const fresh = await fetchFoodsByIds(order.items.map((i) => i.foodItemId)); let added = 0, skipped = 0
      for (const item of order.items) { const food = fresh.get(item.foodItemId); if (!food || food.groups.some((g) => g.isRequired) || food.stock === 0) { skipped++; continue }
        if (cart.add(food, item.quantity) === 'added') added++; else skipped++ }
      toast.show(added ? `${added} item${added > 1 ? 's' : ''} added to your bag${skipped ? ` · ${skipped} need your attention` : ''}` : 'Those items need to be picked again from the menu.', added ? 'green' : 'red')
      navigate(added ? '/cart' : `/outlet/${order.outletId}`)
    } catch { toast.show('Could not reorder right now.', 'red') }
  }

  return <Page className="page-orders">
    <PageHeading eyebrow="THE RECEIPTS" title={<>Your order<br /><em>story.</em></>} action={<Link to="/explore" className="button button-dark">New craving <span aria-hidden="true">↗</span></Link>} />
    <Tabs label="Order filter" value={tab} onChange={setTab} tabs={[{ id: 'active', label: 'Active', count: (orders.data ?? []).filter((o) => ACTIVE.includes(o.status)).length }, { id: 'past', label: 'Past' }]} />
    {orders.loading && !orders.data ? <Skeleton rows={3} height={110} /> : orders.error ? <ErrorState message={orders.error} onRetry={orders.reload} /> :
      !list.length ? <EmptyState title={tab === 'active' ? 'No active orders' : 'No past orders yet'} copy={tab === 'active' ? 'Hungry? Your next order will show up here.' : 'Once you pick something up, it lands here.'} action="Browse the menu" onAction={() => navigate('/explore')} /> :
      <div className="stack">{list.map((o) => <article className="order-card" key={o.id}>
        <div className="row-between"><div><h3><Link to={`/orders/${o.id}`}>{o.outletName}</Link></h3><p className="mono">{o.number} · {formatDateTime(o.createdAt)}</p></div><OrderStatusBadges order={o} /></div>
        <p>{o.items.map((i) => `${i.name} × ${i.quantity}`).join(' · ')}</p>
        <div className="row-between"><span className="mono" style={{ fontSize: 12 }}>Pickup: {slotText(o)}</span><strong>{formatMoney(o.total)}</strong></div>
        <div className="row"><Link to={`/orders/${o.id}`} className="button button-dark small-button">{ACTIVE.includes(o.status) ? 'Track order' : 'View details'}</Link>
          {!ACTIVE.includes(o.status) && <button type="button" className="button button-light small-button" onClick={() => void reorder(o)}>Reorder</button>}
          {o.status === 'PICKED_UP' && <Link to={`/orders/${o.id}#reviews`} className="button button-light small-button">Rate this order</Link>}</div>
      </article>)}</div>}
  </Page>
}
