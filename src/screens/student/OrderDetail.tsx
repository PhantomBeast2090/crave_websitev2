import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { cancelMyOrder, fetchOrder, subscribeToOrders } from '../../lib/api/orders'
import { payForOrder, paymentMessages, razorpayContact } from '../../lib/api/payments'
import { friendlyError, logError } from '../../lib/errors'
import { formatMoney } from '../../lib/pricing'
import { formatDateTime } from '../../lib/time'
import type { Order } from '../../types'
import { useReadyAuth } from '../../state/auth'
import { Link, useRouter } from '../../state/router'
import { useToast } from '../../state/toast'
import { useAsync } from '../../state/useAsync'
import { Dialog, EmptyState, ErrorState, Page, PageHeading, Skeleton } from '../../ui/kit'
import { useStudent } from './context'
import { OrderStatusBadges, slotText } from './Orders'
import { OrderReviews } from './Reviews'

const live = (o: Order) => ['PLACED', 'ACCEPTED', 'PREPARING', 'READY'].includes(o.status)
const isPaid = (o: Order) => ['PAID', 'CAPTURED'].includes(o.paymentStatus)

function Qr({ token }: { token: string }) {
  const [src, setSrc] = useState('')
  useEffect(() => { let alive = true; QRCode.toDataURL(token, { width: 400, margin: 1, errorCorrectionLevel: 'M' }).then((url) => { if (alive) setSrc(url) }).catch((e) => logError('qr', e)); return () => { alive = false } }, [token])
  return <div className="qr-box">{src ? <img src={src} alt="Pickup QR code. Show it at the counter." width={200} height={200} /> : <Skeleton rows={1} height={200} />}<span className="mono muted" style={{ fontSize: 11 }}>Pickup code · {token.slice(0, 8)}…</span></div>
}

function Countdown({ until }: { until?: string | null }) {
  const [left, setLeft] = useState(() => until ? new Date(until).getTime() - Date.now() : 0)
  useEffect(() => { if (!until) return; const id = window.setInterval(() => setLeft(new Date(until).getTime() - Date.now()), 1000); return () => window.clearInterval(id) }, [until])
  if (!until) return null
  if (left <= 0) return <>expired</>
  return <>{Math.floor(left / 60000)}:{String(Math.floor((left % 60000) / 1000)).padStart(2, '0')} left</>
}

export function OrderDetailPage({ id }: { id: string }) {
  const { profile } = useReadyAuth()
  const { navigate, query } = useRouter()
  const toast = useToast()
  const { refreshOrders } = useStudent()
  const order = useAsync(() => fetchOrder(id), [id])
  const [busy, setBusy] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [payNote, setPayNote] = useState<{ title: string; body: string; danger?: boolean } | null>(null)
  useEffect(() => subscribeToOrders(order.reload), [order.reload])   // eslint-disable-line react-hooks/exhaustive-deps
  // A just-paid order may still be settling (webhook): poll gently while we wait.
  const confirming = query.get('confirming') === '1' && order.data && !isPaid(order.data) && live(order.data)
  useEffect(() => { if (!confirming) return; const t = window.setInterval(order.reload, 4000); return () => window.clearInterval(t) }, [confirming, order.reload])  // eslint-disable-line react-hooks/exhaustive-deps

  if (order.loading && !order.data) return <Page><Skeleton rows={3} height={120} /></Page>
  if (order.error) return <Page><ErrorState message={order.error} onRetry={order.reload} /></Page>
  const o = order.data
  if (!o) return <Page><EmptyState title="We can't find that order" copy="It may belong to another account." action="My orders" onAction={() => navigate('/orders')} /></Page>

  const unpaidOnline = o.paymentMethod === 'ONLINE' && !isPaid(o) && o.status === 'PLACED' && o.paymentStatus !== 'REFUNDED'
  const expired = unpaidOnline && !!o.paymentExpiresAt && new Date(o.paymentExpiresAt).getTime() < Date.now()
  const canCancel = o.status === 'PLACED' && !isPaid(o)
  const showQr = live(o) && !!o.token && !o.tokenUsed && (o.paymentMethod === 'PAY_AT_COUNTER' || isPaid(o))
  const steps = [
    { label: 'Order placed', at: o.createdAt, done: true },
    { label: 'Accepted by the outlet', at: o.acceptedAt, done: !!o.acceptedAt },
    { label: 'Being prepared', at: o.preparingAt, done: !!o.preparingAt },
    { label: 'Ready for pickup', at: o.readyAt, done: !!o.readyAt },
    { label: 'Picked up', at: o.pickedUpAt, done: !!o.pickedUpAt },
  ]
  const current = steps.findIndex((s) => !s.done)

  const pay = async () => {
    if (busy) return; setBusy(true); setPayNote(null)
    try {
      const outcome = await payForOrder(o.id, { name: profile.name, email: profile.email, contact: razorpayContact(profile.phone) })
      if (outcome.kind === 'paid') toast.show('Payment received — your order is confirmed!', 'green')
      else if (outcome.kind === 'confirming') setPayNote({ ...paymentMessages.confirming })
      else setPayNote({ ...paymentMessages[outcome.kind], danger: outcome.kind === 'failed' })
      order.reload(); refreshOrders()
    } catch (error) { logError('order:pay', error); setPayNote({ title: paymentMessages.failed.title, body: friendlyError(error, paymentMessages.failed.body), danger: true }) }
    finally { setBusy(false) }
  }
  const cancel = async () => {
    setBusy(true)
    try { await cancelMyOrder(o.id, 'Cancelled by student'); toast.show('Order cancelled', 'ink'); setConfirmCancel(false); order.reload(); refreshOrders() }
    catch (error) { toast.show(friendlyError(error, 'Could not cancel this order.'), 'red') } finally { setBusy(false) }
  }

  return <Page className="page-tracking">
    <Link to="/orders" className="back-link"><span aria-hidden="true">←</span> all orders</Link>
    <PageHeading eyebrow={`ORDER · ${o.number}`} title={<>{o.outletName}</>}><OrderStatusBadges order={o} /></PageHeading>

    {query.get('placed') === '1' && <div className="banner banner-ok" role="status"><div><strong>Order placed!</strong><p>Show the QR code below at the counter when your slot starts and pay then.</p></div></div>}
    {query.get('paid') === '1' && isPaid(o) && <div className="banner banner-ok" role="status"><div><strong>Payment received</strong><p>Your order is confirmed and with the outlet now.</p></div></div>}
    {confirming && <div className="banner banner-warn" role="status"><div><strong>{paymentMessages.confirming.title}</strong><p>{paymentMessages.confirming.body}</p></div></div>}
    {payNote && <div className={`banner ${payNote.danger ? 'banner-danger' : ''}`} role="alert"><div><strong>{payNote.title}</strong><p>{payNote.body}</p></div></div>}
    {unpaidOnline && !expired && !confirming && <div className="banner banner-warn" role="status" style={{ marginTop: 12 }}><div><strong>Complete your payment</strong><p>We're holding your food for <Countdown until={o.paymentExpiresAt} />. {o.paymentStatus === 'FAILED' ? 'Your last attempt did not go through.' : ''}</p></div>
      <div className="banner-actions"><button type="button" className="button button-primary small-button" disabled={busy} onClick={() => void pay()}>{busy ? 'Opening…' : `Pay ${formatMoney(o.total)}`}</button><button type="button" className="button button-light small-button" disabled={busy} onClick={() => setConfirmCancel(true)}>Cancel order</button></div></div>}
    {o.paymentStatus === 'PAID' && ['CANCELLED', 'REJECTED', 'EXPIRED'].includes(o.status) && <div className="banner banner-warn" role="status"><div><strong>Refund on its way</strong><p>This order was {o.status.toLowerCase()} after you paid. Campus management will refund {formatMoney(o.total)} to your original payment method. Contact support if it takes more than a few days.</p></div></div>}
    {['CANCELLED', 'REJECTED', 'EXPIRED'].includes(o.status) && o.cancellationReason && <p className="muted">Reason: {o.cancellationReason}</p>}

    <div className="two-col" style={{ marginTop: 18 }}>
      <div className="stack">
        {showQr && <section className="step-card tracking-card" aria-labelledby="qr-h"><span className="eyebrow">PICKUP TOKEN</span><h2 id="qr-h">Show this at the counter</h2><Qr token={o.token!} /><p style={{ margin: 0, fontSize: 12 }}>Pickup {slotText(o)}</p></section>}
        <section className="step-card" aria-labelledby="st-h"><span className="eyebrow">LIVE STATUS</span><h2 id="st-h">Where it's at</h2>
          {['CANCELLED', 'REJECTED', 'EXPIRED'].includes(o.status) ? <p className="muted">This order was {o.status.toLowerCase()} {formatDateTime(o.cancelledAt)}.</p> :
            <ol className="timeline">{steps.map((s, i) => <li key={s.label} className={s.done ? 'done' : i === current ? 'current' : ''}><span className="dot" aria-hidden="true">{s.done ? '✓' : i === current ? '•' : ''}</span><div><strong>{s.label}</strong>{s.at && <small>{formatDateTime(s.at)}</small>}</div></li>)}</ol>}
          <div className="status-bottom"><span>Pickup slot</span><strong>{slotText(o)}</strong></div>
        </section>
      </div>
      <aside className="summary-card" aria-label="Receipt"><span className="eyebrow">RECEIPT</span>
        {o.items.map((i) => <div key={i.id}><div className="summary-line"><span>{i.quantity} × {i.name}</span><strong>{formatMoney(i.totalPrice)}</strong></div>{(i.options.length > 0 || i.note) && <small className="muted">{[...i.options, i.note].filter(Boolean).join(' · ')}</small>}</div>)}
        <div className="summary-line"><span>Subtotal</span><strong>{formatMoney(o.subtotal)}</strong></div><div className="summary-line"><span>Tax</span><strong>{formatMoney(o.tax)}</strong></div>
        <div className="summary-line summary-total"><span>Total</span><strong>{formatMoney(o.total)}</strong></div>
        {canCancel && !unpaidOnline && <button type="button" className="button button-danger full-button" onClick={() => setConfirmCancel(true)}>Cancel order</button>}
        {o.status === 'PLACED' && isPaid(o) && <p className="muted" style={{ fontSize: 12, margin: 0 }}>Paid orders can't be cancelled here. Please talk to the outlet.</p>}
      </aside>
    </div>

    {o.status === 'PICKED_UP' && <section className="section-block" id="reviews" aria-labelledby="rv-h"><div className="section-heading"><div><span className="eyebrow">YOUR TURN</span><h2 id="rv-h">Rate your order</h2></div></div><OrderReviews order={o} /></section>}

    {confirmCancel && <Dialog title="Cancel this order?" onClose={() => setConfirmCancel(false)} actions={<><button type="button" className="button button-light" onClick={() => setConfirmCancel(false)}>Keep order</button><button type="button" className="button button-danger" disabled={busy} onClick={() => void cancel()}>{busy ? 'Cancelling…' : 'Yes, cancel it'}</button></>}>
      <p>{unpaidOnline ? 'No amount has been charged for this order.' : 'The outlet will be told, and your slot is released.'}</p></Dialog>}
  </Page>
}
