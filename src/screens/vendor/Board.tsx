import { useEffect, useRef, useState } from 'react'
import { fetchVendorDashboard, fetchVendorOrders, setOutletOpen, verifyPickupToken, vendorOrderAction, type VendorAction } from '../../lib/api/staff'
import { subscribeToOrders } from '../../lib/api/orders'
import { friendlyError, logError } from '../../lib/errors'
import { formatMoney } from '../../lib/pricing'
import { formatDateTime, formatTime12, dayLabel } from '../../lib/time'
import { paymentLabel } from '../../lib/ui-helpers'
import type { Order } from '../../types'
import { useToast } from '../../state/toast'
import { useAsync } from '../../state/useAsync'
import { Badge, Dialog, EmptyState, ErrorState, Metric, Page, PageHeading, Panel, Skeleton } from '../../ui/kit'
import { OutletPicker, useVendor } from './context'

const NEXT: Partial<Record<Order['status'], { action: VendorAction; label: string }>> = {
  PLACED: { action: 'accept', label: 'Accept' }, ACCEPTED: { action: 'prepare', label: 'Start cooking' }, PREPARING: { action: 'ready', label: 'Mark ready' },
}

function VerifyDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [scanning, setScanning] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const canScan = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia

  const verify = async (value: string) => {
    if (busy || !value.trim()) return
    setBusy(true); setError('')
    try { const r = await verifyPickupToken(value); toast.show(`Order ${r.order_number} handed over ✔`, 'green'); onDone(); onClose() }
    catch (e) { logError('verify-token', e); setError(friendlyError(e, 'That code could not be verified.')) } finally { setBusy(false) }
  }

  useEffect(() => {
    if (!scanning) return
    let stream: MediaStream | undefined, stop = false
    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (video.current) { video.current.srcObject = stream; await video.current.play() }
        const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] })
        while (!stop) {
          const codes = video.current ? await detector.detect(video.current) : []
          if (codes[0]?.rawValue) { setScanning(false); setToken(codes[0].rawValue); void verify(codes[0].rawValue); return }
          await new Promise((r) => setTimeout(r, 300))
        }
      } catch (e) { logError('scan', e); setError('Could not use the camera. Paste the code instead.'); setScanning(false) }
    })()
    return () => { stop = true; stream?.getTracks().forEach((t) => t.stop()) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanning])

  return <Dialog title="Verify pickup code" onClose={onClose} actions={<><button type="button" className="button button-light" onClick={onClose}>Close</button><button type="button" className="button button-primary" disabled={busy || !token.trim()} onClick={() => void verify(token)}>{busy ? 'Checking…' : 'Verify & hand over'}</button></>}>
    <p className="muted">Scan the student's QR code, or paste the code from their order screen. The order must be marked <strong>Ready</strong>.</p>
    {canScan && <button type="button" className="button button-dark small-button" onClick={() => setScanning((s) => !s)}>{scanning ? 'Stop camera' : 'Scan with camera'}</button>}
    {scanning && <video ref={video} muted playsInline style={{ width: '100%', borderRadius: 12, marginTop: 10 }} aria-label="Camera preview" />}
    <div className="field" style={{ marginTop: 12 }}><label htmlFor="vt">Pickup code</label><input id="vt" value={token} onChange={(e) => setToken(e.target.value.trim())} autoComplete="off" spellCheck={false} placeholder="Paste the code" /></div>
    {error && <p role="alert" className="field-error">{error}</p>}
  </Dialog>
}

function Ticket({ order, onAction, busy }: { order: Order; onAction: (order: Order, action: VendorAction) => void; busy: boolean }) {
  const next = NEXT[order.status]
  return <article className="ticket" aria-label={`Order ${order.number}`}>
    <header><strong>{order.number.replace('GAG-', '')}</strong><span>{order.slotDate ? `${dayLabel(order.slotDate)} ${order.slotStart ? formatTime12(order.slotStart) : ''}` : ''}</span></header>
    <div className="row"><strong>{order.customerName ?? 'Student'}</strong><Badge tone={['PAID', 'CAPTURED'].includes(order.paymentStatus) ? 'green' : 'neutral'}>{paymentLabel(order.paymentStatus, order.paymentMethod)}</Badge></div>
    <ul>{order.items.map((i) => <li key={i.id}>{i.quantity} × {i.name}{i.options.length ? ` (${i.options.join(', ')})` : ''}{i.note && <div className="note">“{i.note}”</div>}</li>)}</ul>
    <div className="row-between"><span className="mono" style={{ fontSize: 12 }}>{formatMoney(order.total)}</span><span className="muted" style={{ fontSize: 11 }}>{formatDateTime(order.createdAt)}</span></div>
    <div className="ticket-actions">
      {next && <button type="button" className="button button-primary small-button" disabled={busy} onClick={() => onAction(order, next.action)}>{next.label}</button>}
      {['PLACED', 'ACCEPTED', 'PREPARING'].includes(order.status) && <button type="button" className="button button-danger small-button" disabled={busy} onClick={() => onAction(order, 'reject')}>Reject</button>}
    </div>
  </article>
}

export function VendorBoard() {
  const { outletId, outlets, reloadOutlets } = useVendor()
  const toast = useToast()
  const dash = useAsync(() => fetchVendorDashboard(outletId), [outletId])
  const orders = useAsync(() => fetchVendorOrders(outletId, 'active'), [outletId])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState<Order | null>(null)
  const [reason, setReason] = useState('')
  const [verifying, setVerifying] = useState(false)
  const reloadAll = () => { orders.reload(); dash.reload() }
  useEffect(() => subscribeToOrders(reloadAll), [outletId])   // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (order: Order, action: VendorAction, why?: string) => {
    setBusyId(order.id)
    try { await vendorOrderAction(order.id, action, why); reloadAll(); if (action === 'reject') { setRejecting(null); setReason('') } }
    catch (e) { logError('vendor-action', e); toast.show(friendlyError(e, 'Could not update the order.'), 'red'); reloadAll() } finally { setBusyId(null) }
  }
  const toggleOpen = async (id: string, open: boolean) => {
    try { await setOutletOpen(id, open); toast.show(open ? 'Outlet is now open for orders' : 'Outlet closed for same-day orders', 'ink'); reloadOutlets(); dash.reload() }
    catch (e) { toast.show(friendlyError(e, 'Could not change the outlet status.'), 'red') }
  }

  const cols = [
    { title: 'New', statuses: ['PLACED'], tone: 'orange' as const }, { title: 'Cooking', statuses: ['ACCEPTED', 'PREPARING'], tone: 'blue' as const }, { title: 'Ready for pickup', statuses: ['READY'], tone: 'green' as const },
  ]
  const d = dash.data
  return <Page className="page-ops">
    <PageHeading eyebrow="VENDOR CONSOLE" title={<>Make lunch<br /><em>move.</em></>} action={<div className="row"><OutletPicker /><button type="button" className="button button-dark" onClick={() => setVerifying(true)}>Verify pickup <span aria-hidden="true">↗</span></button></div>} />
    {dash.error ? <ErrorState message={dash.error} onRetry={dash.reload} /> : <div className="metric-grid">
      <Metric value={d ? d.ordersToday : '…'} label="orders today" tone="tangerine" /><Metric value={d ? formatMoney(d.revenueToday) : '…'} label="paid revenue today" tone="aqua" />
      <Metric value={d ? d.newOrders : '…'} label="waiting to be accepted" tone="lavender" /><Metric value={d ? d.completedToday : '…'} label="picked up today" tone="chartreuse" /></div>}
    <Panel title="Your outlets" eyebrow="OPEN / CLOSE" className="" >
      {outlets.filter((o) => !outletId || o.id === outletId).map((o) => <div className="list-row" key={o.id}><div className="grow"><span className="cell-title">{o.name}</span><span className="cell-sub">{o.isOpen ? 'Taking orders for today' : 'Closed for same-day orders (pre-orders still allowed)'}</span></div>
        <button type="button" role="switch" aria-checked={o.isOpen} aria-label={`${o.name} open`} className="switch" onClick={() => void toggleOpen(o.id, !o.isOpen)} /></div>)}
    </Panel>
    <h2 style={{ margin: '26px 0 12px', fontSize: 22 }}>Live orders</h2>
    {orders.loading && !orders.data ? <Skeleton rows={2} height={140} /> : orders.error ? <ErrorState message={orders.error} onRetry={orders.reload} /> :
      !orders.data?.length ? <EmptyState title="All quiet" copy="New orders appear here the moment a student pays or places one." /> :
      <div className="board">{cols.map((c) => { const list = orders.data!.filter((o) => c.statuses.includes(o.status))
        return <section className="board-col" key={c.title} aria-label={c.title}><h2>{c.title}<Badge tone={c.tone}>{list.length}</Badge></h2>
          {list.map((o) => <div key={o.id}><Ticket order={o} busy={busyId === o.id} onAction={(order, action) => action === 'reject' ? setRejecting(order) : void act(order, action)} />
            {o.status === 'READY' && <p className="muted" style={{ fontSize: 12, margin: '6px 4px 0' }}>Scan the student's QR to hand over.</p>}</div>)}
          {!list.length && <p className="muted" style={{ fontSize: 13, margin: 0 }}>Nothing here.</p>}</section> })}</div>}
    {verifying && <VerifyDialog onClose={() => setVerifying(false)} onDone={reloadAll} />}
    {rejecting && <Dialog title={`Reject ${rejecting.number}?`} onClose={() => setRejecting(null)} actions={<><button type="button" className="button button-light" onClick={() => setRejecting(null)}>Keep it</button>
      <button type="button" className="button button-danger" disabled={busyId === rejecting.id} onClick={() => void act(rejecting, 'reject', reason)}>Reject order</button></>}>
      <p>{['PAID', 'CAPTURED'].includes(rejecting.paymentStatus) ? 'The student already paid online — management will be asked to refund them.' : 'The student will be told and the slot is released.'}</p>
      <div className="field"><label htmlFor="rj">Reason (shown to the student)</label><input id="rj" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="Out of stock, kitchen closed…" /></div></Dialog>}
  </Page>
}
