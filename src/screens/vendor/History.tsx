import { fetchVendorOrders } from '../../lib/api/staff'
import { formatMoney } from '../../lib/pricing'
import { formatDateTime } from '../../lib/time'
import { paymentLabel, statusLabel } from '../../lib/ui-helpers'
import { useAsync } from '../../state/useAsync'
import { Badge, EmptyState, ErrorState, Page, PageHeading, Skeleton } from '../../ui/kit'
import { OutletPicker, useVendor } from './context'
import { statusTone } from '../student/Orders'

export function VendorHistory() {
  const { outletId } = useVendor()
  const orders = useAsync(() => fetchVendorOrders(outletId, 'history', 100), [outletId])
  return <Page>
    <PageHeading eyebrow="ORDER HISTORY" title={<>Past <em>orders.</em></>} action={<OutletPicker />} />
    {orders.loading && !orders.data ? <Skeleton rows={4} height={50} /> : orders.error ? <ErrorState message={orders.error} onRetry={orders.reload} /> : !orders.data?.length ? <EmptyState title="No finished orders yet" /> :
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Scrollable table"><table className="data-table"><thead><tr><th>Order</th><th>Student</th><th>Items</th><th>Status</th><th>Payment</th><th className="num">Total</th></tr></thead><tbody>
        {orders.data.map((o) => <tr key={o.id}><td><span className="cell-title mono">{o.number}</span><span className="cell-sub">{formatDateTime(o.createdAt)}</span></td><td>{o.customerName ?? '—'}</td>
          <td>{o.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}</td><td><Badge tone={statusTone(o.status)}>{statusLabel(o.status)}</Badge></td><td>{paymentLabel(o.paymentStatus, o.paymentMethod)}</td><td className="num">{formatMoney(o.total)}</td></tr>)}</tbody></table></div>}
  </Page>
}
