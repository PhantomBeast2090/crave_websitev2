import { useState } from 'react'
import { fetchPayments, fetchRefundCandidates, refundOrder, type RefundCandidate } from '../../lib/api/staff'
import { friendlyError } from '../../lib/errors'
import { formatMoney } from '../../lib/pricing'
import { formatDateTime } from '../../lib/time'
import { statusLabel } from '../../lib/ui-helpers'
import { useToast } from '../../state/toast'
import { useAsync } from '../../state/useAsync'
import { Badge, ConfirmDialog, EmptyState, ErrorState, Page, PageHeading, Pager, Panel, Skeleton } from '../../ui/kit'

const tone = (s: string) => ['PAID', 'CAPTURED'].includes(s) ? 'green' : s === 'FAILED' ? 'red' : s === 'REFUNDED' ? 'blue' : 'neutral'

export function AdminPayments() {
  const toast = useToast()
  const [status, setStatus] = useState('all')
  const [provider, setProvider] = useState('all')
  const [page, setPage] = useState(0)
  const [refunding, setRefunding] = useState<RefundCandidate | null>(null)
  const [busy, setBusy] = useState(false)
  const payments = useAsync(() => fetchPayments({ status, provider, page }), [status, provider, page])
  const candidates = useAsync(fetchRefundCandidates, [])

  const refund = async () => {
    if (!refunding) return
    setBusy(true)
    try { await refundOrder(refunding.order_id); toast.show('Refund issued via Razorpay', 'green'); setRefunding(null); candidates.reload(); payments.reload() }
    catch (e) { toast.show(friendlyError(e, (e as Error).message || 'The refund could not be processed.'), 'red') } finally { setBusy(false) }
  }
  return <Page>
    <PageHeading eyebrow="MONEY" title={<>Payments &amp; <em>refunds.</em></>} />
    {candidates.data && candidates.data.length > 0 && <Panel title={`${candidates.data.length} refund${candidates.data.length > 1 ? 's' : ''} needed`} eyebrow="ACTION REQUIRED" className="">
      {candidates.data.map((c) => <div className="list-row" key={c.order_id}><div className="grow"><span className="cell-title mono">{c.order_number}</span><span className="cell-sub">{c.student_name} · {statusLabel(c.order_status)} · paid {formatDateTime(c.paid_at)}</span></div><strong className="mono">{formatMoney(Number(c.amount))}</strong>
        <button type="button" className="button button-primary small-button" onClick={() => setRefunding(c)}>Refund</button></div>)}</Panel>}
    {candidates.error && <ErrorState message={candidates.error} onRetry={candidates.reload} />}
    <h2 style={{ margin: '26px 0 12px', fontSize: 22 }}>All payments</h2>
    <div className="filter-bar"><div className="field"><label htmlFor="ap-s">Status</label><select id="ap-s" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }}>{['all', 'PENDING', 'CREATED', 'AUTHORIZED', 'PAID', 'CAPTURED', 'FAILED', 'REFUNDED'].map((s) => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s}</option>)}</select></div>
      <div className="field"><label htmlFor="ap-p">Method</label><select id="ap-p" value={provider} onChange={(e) => { setProvider(e.target.value); setPage(0) }}><option value="all">All</option><option value="RAZORPAY">Razorpay</option><option value="CASH">Cash</option></select></div></div>
    {payments.loading && !payments.data ? <Skeleton rows={5} height={52} /> : payments.error ? <ErrorState message={payments.error} onRetry={payments.reload} /> : !payments.data?.payments.length ? <EmptyState title="No payments match" /> : <>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Scrollable table"><table className="data-table"><thead><tr><th>Order</th><th>Student</th><th>Method</th><th>Status</th><th>Razorpay ref</th><th className="num">Amount</th></tr></thead><tbody>
        {payments.data.payments.map((p) => <tr key={p.id}><td><span className="cell-title mono">{p.orderNumber}</span><span className="cell-sub">{statusLabel(p.orderStatus)} · {formatDateTime(p.createdAt)}</span></td><td>{p.customer ?? '—'}</td><td>{p.provider === 'RAZORPAY' ? 'Razorpay' : 'Cash'}</td>
          <td><Badge tone={tone(p.status)}>{p.status}</Badge></td><td className="mono" style={{ fontSize: 11 }}>{p.razorpayPaymentId ?? '—'}</td><td className="num">{formatMoney(p.amount)}</td></tr>)}</tbody></table></div>
      <Pager page={page} pageSize={25} total={payments.data.total} onPage={setPage} /></>}
    {refunding && <ConfirmDialog title={`Refund ${formatMoney(Number(refunding.amount))}?`} danger confirmLabel="Issue refund" busy={busy} onClose={() => setRefunding(null)} onConfirm={() => void refund()}
      body={`This sends ${formatMoney(Number(refunding.amount))} back to ${refunding.student_name} through Razorpay for order ${refunding.order_number}. It cannot be undone.`} />}
  </Page>
}
