import { useState } from 'react'
import { adminCancelOrder, fetchAdminOrders } from '../../lib/api/staff'
import { friendlyError } from '../../lib/errors'
import { formatMoney } from '../../lib/pricing'
import { formatDateTime } from '../../lib/time'
import { paymentLabel, statusLabel } from '../../lib/ui-helpers'
import type { Order } from '../../types'
import { useToast } from '../../state/toast'
import { useAsync, useDebounced } from '../../state/useAsync'
import { Badge, ConfirmDialog, EmptyState, ErrorState, Page, PageHeading, Pager, Skeleton } from '../../ui/kit'
import { statusTone } from '../student/Orders'

const STATUSES = ['all', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'PICKED_UP', 'CANCELLED', 'REJECTED', 'EXPIRED']

export function AdminOrders() {
  const toast = useToast()
  const [status, setStatus] = useState('all')
  const [search, setSearch] = useState('')
  const q = useDebounced(search)
  const [page, setPage] = useState(0)
  const [cancelling, setCancelling] = useState<Order | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const orders = useAsync(() => fetchAdminOrders({ status, search: q, page }), [status, q, page])

  const cancel = async () => {
    if (!cancelling) return
    setBusy(true)
    try { await adminCancelOrder(cancelling.id, reason.trim() || 'Cancelled by management'); toast.show('Order cancelled', 'ink'); setCancelling(null); setReason(''); orders.reload() }
    catch (e) { toast.show(friendlyError(e, 'Could not cancel the order.'), 'red') } finally { setBusy(false) }
  }
  return <Page>
    <PageHeading eyebrow="OPERATIONS" title={<>Every <em>order.</em></>} />
    <div className="filter-bar"><div className="grow field"><label htmlFor="ao-q">Order number</label><input id="ao-q" type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }} placeholder="GAG-2026…" maxLength={40} /></div>
      <div className="field"><label htmlFor="ao-s">Status</label><select id="ao-s" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }}>{STATUSES.map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : statusLabel(s)}</option>)}</select></div></div>
    {orders.loading && !orders.data ? <Skeleton rows={5} height={52} /> : orders.error ? <ErrorState message={orders.error} onRetry={orders.reload} /> : !orders.data?.orders.length ? <EmptyState title="No orders match" /> : <>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Scrollable table"><table className="data-table"><thead><tr><th>Order</th><th>Student</th><th>Outlet</th><th>Status</th><th>Payment</th><th className="num">Total</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>
        {orders.data.orders.map((o) => <tr key={o.id}><td><span className="cell-title mono">{o.number}</span><span className="cell-sub">{formatDateTime(o.createdAt)}</span></td><td>{o.customerName ?? '—'}</td><td>{o.outletName}</td>
          <td><Badge tone={statusTone(o.status)}>{statusLabel(o.status)}</Badge></td><td>{paymentLabel(o.paymentStatus, o.paymentMethod)}</td><td className="num">{formatMoney(o.total)}</td>
          <td>{['PLACED', 'ACCEPTED', 'PREPARING', 'READY'].includes(o.status) && <button type="button" className="button button-danger small-button" onClick={() => setCancelling(o)}>Cancel</button>}</td></tr>)}</tbody></table></div>
      <Pager page={page} pageSize={25} total={orders.data.total} onPage={setPage} /></>}
    {cancelling && <ConfirmDialog title={`Cancel ${cancelling.number}?`} danger confirmLabel="Cancel order" busy={busy} onClose={() => setCancelling(null)} onConfirm={() => void cancel()}
      body={['PAID', 'CAPTURED'].includes(cancelling.paymentStatus) ? 'This order is already paid. After cancelling, issue the refund from Payments.' : 'The student will be notified and the slot and stock are released.'}>
      <div className="field"><label htmlFor="co-r">Reason</label><input id="co-r" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></div></ConfirmDialog>}
  </Page>
}
