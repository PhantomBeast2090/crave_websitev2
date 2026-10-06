import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchFoodsByIds, fetchOutlet } from '../../lib/api/catalog'
import { cancelMyOrder, fetchPickupSlots, placeOrder, PaymentInProgressError } from '../../lib/api/orders'
import { payForOrder, paymentMessages, razorpayContact, type PaymentOutcome } from '../../lib/api/payments'
import { friendlyError, logError } from '../../lib/errors'
import { formatMoney, orderTotals } from '../../lib/pricing'
import { dayLabel, isSlotBookable, istNow } from '../../lib/time'
import type { CartLine, Order, Outlet } from '../../types'
import { useReadyAuth } from '../../state/auth'
import { useCart } from '../../state/cart'
import { Link, useRouter } from '../../state/router'
import { useToast } from '../../state/toast'
import { useAsync } from '../../state/useAsync'
import { EmptyState, ErrorState, Page, PageHeading, Skeleton } from '../../ui/kit'
import { useStudent } from './context'

type Method = 'ONLINE' | 'PAY_AT_COUNTER'
type Check = { notes: string[]; blocking: { text: string; foodId: string }[]; outlet: Outlet | null }

/** Re-reads price, availability, stock and options from the server so the bag the student confirms is the one that will be ordered. */
async function revalidate(lines: CartLine[]): Promise<{ lines: CartLine[]; check: Check }> {
  const [fresh, outlet] = await Promise.all([fetchFoodsByIds(lines.map((l) => l.foodId)), fetchOutlet(lines[0].outletId)])
  const notes: string[] = [], blocking: Check['blocking'] = [], next: CartLine[] = []
  for (const line of lines) {
    const food = fresh.get(line.foodId)
    if (!food) { notes.push(`${line.name} is no longer available and was removed from your bag.`); continue }
    let quantity = line.quantity
    if (food.stock !== null && food.stock < quantity) {
      if (food.stock <= 0) { notes.push(`${food.name} just sold out and was removed.`); continue }
      notes.push(`Only ${food.stock} ${food.name} left — quantity lowered.`); quantity = food.stock
    }
    const options = line.options.flatMap((o) => { const found = food.groups.flatMap((g) => g.options).find((x) => x.id === o.id); if (!found) notes.push(`"${o.name}" is no longer offered on ${food.name} and was removed.`); return found ? [found] : [] })
    for (const group of food.groups) if (group.isRequired && !options.some((o) => o.variantId === group.id)) blocking.push({ text: `Choose “${group.name}” for ${food.name}.`, foodId: food.id })
    const oldUnit = line.price + line.options.reduce((s, o) => s + o.extraPrice, 0), newUnit = food.price + options.reduce((s, o) => s + o.extraPrice, 0)
    if (Math.abs(oldUnit - newUnit) > 0.001) notes.push(`${food.name} now costs ${formatMoney(newUnit)} (was ${formatMoney(oldUnit)}).`)
    next.push({ ...line, name: food.name, price: food.price, quantity, options, imageUrl: food.imageUrl, isVeg: food.isVeg, outletName: food.outletName ?? line.outletName })
  }
  if (!outlet) blocking.push({ text: 'This outlet is no longer available.', foodId: '' })
  return { lines: next, check: { notes, blocking, outlet } }
}

export function CheckoutPage() {
  const { session, profile } = useReadyAuth()
  const cart = useCart()
  const toast = useToast()
  const { navigate } = useRouter()
  const { refreshOrders } = useStudent()
  const [check, setCheck] = useState<Check | null>(null)
  const [loadError, setLoadError] = useState('')
  const [method, setMethod] = useState<Method>('ONLINE')
  const [day, setDay] = useState('')
  const [slotId, setSlotId] = useState('')
  const [now, setNow] = useState(istNow())
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const [formError, setFormError] = useState('')
  const [resumeId, setResumeId] = useState<string | null>(null)
  const [paying, setPaying] = useState<Order | null>(null)
  const [payment, setPayment] = useState<{ outcome: Exclude<PaymentOutcome, { kind: 'paid' }>; order: Order; snapshot: CartLine[] } | null>(null)
  const startedWith = useRef<CartLine[] | null>(null)

  const outletId = cart.outletId
  useEffect(() => { const id = window.setInterval(() => setNow(istNow()), 20000); return () => window.clearInterval(id) }, [])

  // Re-validate once when the page opens.
  useEffect(() => {
    if (!cart.lines.length || startedWith.current) return
    startedWith.current = cart.lines
    revalidate(cart.lines).then(({ lines, check: result }) => { cart.replaceLines(lines); setCheck(result) }).catch((e) => { logError('checkout:revalidate', e); setLoadError(friendlyError(e, 'We could not check your bag against the latest menu.')) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.lines.length])

  const slots = useAsync(() => fetchPickupSlots(outletId!), [outletId], !!outletId && !!check)
  const bookable = useMemo(() => (slots.data ?? []).filter((s) => isSlotBookable(s, now) && !(check?.outlet && !check.outlet.isOpen && s.slotDate === now.date)), [slots.data, now, check])
  const days = useMemo(() => [...new Set(bookable.map((s) => s.slotDate))].slice(0, 8), [bookable])
  const daySlots = useMemo(() => bookable.filter((s) => s.slotDate === day), [bookable, day])
  useEffect(() => { if (days.length && !days.includes(day)) setDay(days[0]) }, [days, day])
  useEffect(() => { if (!daySlots.some((s) => s.id === slotId)) setSlotId('') }, [daySlots, slotId])

  const totals = orderTotals(cart.lines)

  const runPayment = useCallback(async (order: Order, snapshot: CartLine[]) => {
    setPaying(order)
    try {
      const outcome = await payForOrder(order.id, { name: profile.name, email: profile.email, contact: razorpayContact(profile.phone) })
      refreshOrders()
      if (outcome.kind === 'paid') { toast.show('Payment received — your order is confirmed!', 'green'); navigate(`/orders/${order.id}?paid=1`); return }
      if (outcome.kind === 'confirming') { navigate(`/orders/${order.id}?confirming=1`); return }
      setPayment({ outcome, order: outcome.order ?? order, snapshot })
    } catch (error) {
      logError('checkout:pay', error)
      setPayment({ outcome: { kind: 'failed', order }, order, snapshot })
      setFormError(friendlyError(error, paymentMessages.failed.body))
    } finally { setPaying(null) }
  }, [profile, toast, navigate, refreshOrders])

  const submit = async () => {
    if (inFlight.current) return                       // double-click / Enter-spam guard (the DB is the real guard)
    if (!slotId) return setFormError('Pick a pickup slot first.')
    if (check?.blocking.length) return setFormError(check.blocking[0].text)
    inFlight.current = true; setBusy(true); setFormError('')
    const snapshot = cart.lines
    try {
      const order = await placeOrder(session.user.id, snapshot, slotId, method)
      cart.clear(); refreshOrders()
      if (method === 'PAY_AT_COUNTER') { toast.show('Order placed. Pay at the counter when you pick up.', 'green'); navigate(`/orders/${order.id}?placed=1`); return }
      await runPayment(order, snapshot)
    } catch (error) {
      if (error instanceof PaymentInProgressError) setResumeId(error.orderId)
      else { logError('checkout:place', error); setFormError(friendlyError(error, 'We could not place your order. Please try again.')) }
    } finally { inFlight.current = false; setBusy(false) }
  }

  const retryPayment = async () => { if (!payment || inFlight.current) return; inFlight.current = true; setBusy(true); setFormError(''); const p = payment; setPayment(null); try { await runPayment(p.order, p.snapshot) } finally { inFlight.current = false; setBusy(false) } }
  const abandon = async () => {
    if (!payment || inFlight.current) return
    inFlight.current = true; setBusy(true)
    try { await cancelMyOrder(payment.order.id, 'Payment cancelled by student'); cart.replaceLines(payment.snapshot); setPayment(null); refreshOrders(); toast.show('Order cancelled. Your items are back in your bag.', 'ink'); navigate('/cart') }
    catch (error) { toast.show(friendlyError(error, 'Could not cancel the order.'), 'red') }
    finally { inFlight.current = false; setBusy(false) }
  }

  if (paying) {
    return <Page><PageHeading eyebrow="PAYMENT" title={<>Complete your<br /><em>payment.</em></>} />
      <div className="banner banner-warn" role="status"><div><strong>Waiting for Razorpay</strong><p>Finish paying {formatMoney(paying.total)} in the payment window for order {paying.number}. Please don't close this tab or press Pay again.</p></div></div>
      <p className="muted">If the window closed by mistake, you can reopen it from <Link to={`/orders/${paying.id}`}><u>your order</u></Link>.</p></Page>
  }
  if (payment) {
    const m = payment.outcome.kind === 'cancelled' ? paymentMessages.cancelled : paymentMessages.failed
    return <Page><PageHeading eyebrow="PAYMENT" title={m.title} />
      <div className={`banner ${payment.outcome.kind === 'cancelled' ? '' : 'banner-danger'}`} role="alert"><div><strong>{m.title}</strong><p>{payment.outcome.kind === 'cancelled' ? m.body : formError || m.body}</p></div></div>
      <p className="muted">Your order <strong>{payment.order.number}</strong> ({formatMoney(payment.order.total)}) is on hold for a few minutes. Try again, or cancel it to get your items back.</p>
      <div className="row"><button type="button" className="button button-primary" disabled={busy} onClick={() => void retryPayment()}>Try payment again <span aria-hidden="true">↗</span></button>
        <button type="button" className="button button-light" disabled={busy} onClick={() => void abandon()}>Cancel order &amp; edit bag</button></div></Page>
  }
  if (!cart.lines.length) return <Page><PageHeading eyebrow="CHECKOUT" title="Nothing to check out" /><EmptyState title="Your bag is empty" copy="Add something tasty first." action="Find a craving" onAction={() => navigate('/explore')} /></Page>
  if (loadError) return <Page><ErrorState message={loadError} onRetry={() => window.location.reload()} /></Page>
  if (!check) return <Page><PageHeading eyebrow="LAST LAP" title={<>Checking your bag…</>} /><Skeleton rows={3} height={80} /></Page>

  return <Page className="page-checkout">
    <Link to="/cart" className="back-link"><span aria-hidden="true">←</span> back to bag</Link>
    <PageHeading eyebrow="LAST LAP" title={<>Almost yours.<br /><em>Pick a moment.</em></>} />
    {resumeId && <div className="banner banner-warn" role="alert"><div><strong>You already have a payment in progress</strong><p>Finish or cancel that order before placing a new online order.</p></div><div className="banner-actions"><Link to={`/orders/${resumeId}`} className="button button-dark small-button">Open it</Link></div></div>}
    {check.notes.length > 0 && <div className="banner banner-warn" role="status"><div><strong>We updated your bag</strong>{check.notes.map((n) => <p key={n}>{n}</p>)}</div></div>}
    {check.blocking.length > 0 && <div className="banner banner-danger" role="alert"><div><strong>Before you can order</strong>{check.blocking.map((b) => <p key={b.text}>{b.text} {b.foodId && <Link to={`/food/${b.foodId}`}><u>Fix it</u></Link>}</p>)}</div></div>}
    <div className="two-col" style={{ marginTop: 18 }}>
      <div className="stack">
        <section className="step-card" aria-labelledby="co-slot"><span className="eyebrow">1 · PICKUP SLOT ({check.outlet?.name})</span><h2 id="co-slot">When are you free?</h2>
          {check.outlet && !check.outlet.isOpen && <p className="banner banner-warn" role="status"><span>This outlet is closed right now — pick a slot from tomorrow onwards.</span></p>}
          {slots.loading ? <Skeleton rows={1} height={60} /> : slots.error ? <ErrorState message={slots.error} onRetry={slots.reload} /> : !days.length ? <p className="muted">No pickup slots are open right now. Try again later.</p> : <>
            <div className="day-tabs" role="group" aria-label="Pickup day">{days.map((d) => <button key={d} type="button" className="day-tab" aria-pressed={day === d} onClick={() => setDay(d)}>{dayLabel(d, now.date)}</button>)}</div>
            <div className="slot-grid" role="group" aria-label="Pickup times">{daySlots.map((s) => <button key={s.id} type="button" className="slot-button" aria-pressed={slotId === s.id} onClick={() => setSlotId(s.id)}><strong>{s.label}</strong><small>{s.capacity - s.bookedCount} left</small></button>)}</div></>}
        </section>
        <section className="step-card" aria-labelledby="co-pay"><span className="eyebrow">2 · PAYMENT</span><h2 id="co-pay">How would you like to pay?</h2>
          <button type="button" className="pay-option" aria-pressed={method === 'ONLINE'} onClick={() => setMethod('ONLINE')}><span aria-hidden="true" style={{ fontSize: 22 }}>💳</span><span><strong>Pay online</strong><small>UPI, cards, netbanking via Razorpay. Confirmed instantly.</small></span></button>
          <button type="button" className="pay-option" aria-pressed={method === 'PAY_AT_COUNTER'} onClick={() => setMethod('PAY_AT_COUNTER')}><span aria-hidden="true" style={{ fontSize: 22 }}>🧾</span><span><strong>Pay at the counter</strong><small>Settle when you pick up your order.</small></span></button>
        </section>
      </div>
      <aside className="summary-card" aria-label="Order summary">
        <span className="eyebrow">YOUR ORDER</span>
        {cart.lines.map((l) => <div className="summary-line" key={l.key}><span>{l.quantity} × {l.name}{l.options.length ? ` (${l.options.map((o) => o.name).join(', ')})` : ''}</span><strong>{formatMoney((l.price + l.options.reduce((s, o) => s + o.extraPrice, 0)) * l.quantity)}</strong></div>)}
        <div className="summary-line"><span>Subtotal</span><strong>{formatMoney(totals.subtotal)}</strong></div>
        <div className="summary-line"><span>Tax (5%)</span><strong>{formatMoney(totals.tax)}</strong></div>
        <div className="summary-line summary-total"><span>{method === 'ONLINE' ? 'To pay now' : 'To pay at pickup'}</span><strong>{formatMoney(totals.total)}</strong></div>
        <button type="button" className="button button-primary full-button" disabled={busy || !slotId || check.blocking.length > 0} onClick={() => void submit()}>{busy ? 'Working…' : method === 'ONLINE' ? `Pay ${formatMoney(totals.total)}` : 'Place order'} <span aria-hidden="true">↗</span></button>
        <div role="alert" aria-live="assertive">{formError && <p className="field-error">{formError}</p>}</div>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>Crave re-checks stock, price and slot capacity when you confirm.</p>
      </aside>
    </div>
  </Page>
}
