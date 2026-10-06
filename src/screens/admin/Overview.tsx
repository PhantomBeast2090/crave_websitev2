import { useState } from 'react'
import { fetchDashboard } from '../../lib/api/staff'
import { formatMoney } from '../../lib/pricing'
import { formatDateTime } from '../../lib/time'
import { Link } from '../../state/router'
import { useAsync } from '../../state/useAsync'
import { ErrorState, LineChart, Metric, Page, PageHeading, Panel, Skeleton, Tabs } from '../../ui/kit'

export function AdminOverview({ analytics }: { analytics?: boolean }) {
  const [days, setDays] = useState<'7' | '14' | '30' | '90'>(analytics ? '30' : '14')
  const dash = useAsync(() => fetchDashboard(Number(days)), [days])
  const d = dash.data
  return <Page className="page-ops page-admin">
    <PageHeading eyebrow={analytics ? 'ANALYTICS' : 'ADMIN HQ · SRMIST CAMPUS'} title={analytics ? <>Numbers, <em>honestly.</em></> : <>Campus at<br /><em>a glance.</em></>}>{d && <span className="muted" style={{ fontSize: 12 }}>Updated {formatDateTime(d.generatedAt)} · all times IST</span>}</PageHeading>
    <Tabs label="Date range" value={days} onChange={setDays} tabs={[{ id: '7', label: '7 days' }, { id: '14', label: '14 days' }, { id: '30', label: '30 days' }, { id: '90', label: '90 days' }]} />
    {dash.loading && !d ? <Skeleton rows={3} height={120} /> : dash.error ? <ErrorState message={dash.error} onRetry={dash.reload} /> : d && <>
      {d.refundRequiredCount > 0 && <div className="banner banner-warn" role="alert" style={{ marginBottom: 14 }}><div><strong>{d.refundRequiredCount} payment{d.refundRequiredCount > 1 ? 's' : ''} need a refund ({formatMoney(d.refundRequiredAmount)})</strong><p>Orders were cancelled or rejected after the student paid.</p></div><div className="banner-actions"><Link to="/admin/payments" className="button button-dark small-button">Review refunds</Link></div></div>}
      <div className="metric-grid">
        <Metric value={d.ordersToday} label="orders today" hint={`${d.ordersThisWeek} this week`} tone="tangerine" />
        <Metric value={formatMoney(d.revenueToday)} label="paid revenue today" hint={`${formatMoney(d.revenueThisWeek)} this week`} tone="aqua" />
        <Metric value={d.activeOrders} label="active orders" hint={`${d.completedOrders} completed all-time`} tone="lavender" />
        <Metric value={formatMoney(d.revenueThisMonth)} label="paid revenue this month" hint={`${d.ordersThisMonth} orders`} tone="chartreuse" />
      </div>
      <div className="panel-grid">
        <Panel title="Orders per day" eyebrow="TREND"><LineChart data={d.trend} valueKey="orders" label="Orders per day" /></Panel>
        <Panel title="Paid revenue per day" eyebrow="TREND"><LineChart data={d.trend} valueKey="revenue" label="Paid revenue per day" format={(v) => formatMoney(v)} tone="ink" /></Panel>
      </div>
      <div className="panel-grid">
        <Panel title="Where the money came from" eyebrow="PAYMENT SPLIT">
          {[['Online (Razorpay)', d.razorpayRevenue], ['Cash at counter', d.cashRevenue], ['Refunded', d.refundedAmount]].map(([label, value]) => <div className="list-row" key={label as string}><div className="grow">{label}</div><strong className="mono">{formatMoney(Number(value))}</strong></div>)}
          <div className="list-row"><div className="grow"><strong>Total paid revenue</strong><span className="cell-sub">Only payments in PAID / CAPTURED. Failed, pending, authorised and refunded amounts are excluded.</span></div><strong className="mono">{formatMoney(d.paidRevenue)}</strong></div>
          <div className="list-row"><div className="grow">Failed payments</div><span className="mono">{d.failedPayments}</span></div><div className="list-row"><div className="grow">Awaiting payment (live orders)</div><span className="mono">{d.pendingPayments}</span></div>
        </Panel>
        <Panel title="Order outcomes" eyebrow="ALL TIME">
          {[['Completed', d.completedOrders], ['Active', d.activeOrders], ['Cancelled / expired', d.cancelledOrders], ['Rejected', d.rejectedOrders], ['Total', d.totalOrders]].map(([label, value]) => <div className="list-row" key={label as string}><div className="grow">{label}</div><span className="mono">{value}</span></div>)}
        </Panel>
      </div>
      <div className="panel-grid">
        <Panel title="Top outlets (30 days)" eyebrow="LEADERBOARD" action={<Link to="/admin/outlets" className="text-button">all outlets ↗</Link>}>
          {d.topOutlets.length ? d.topOutlets.map((o) => <div className="list-row" key={o.outlet_id}><div className="grow"><span className="cell-title">{o.name}</span><span className="cell-sub">{o.orders} orders</span></div><strong className="mono">{formatMoney(Number(o.revenue))}</strong></div>) : <p className="muted">No orders in the last 30 days.</p>}
        </Panel>
        <Panel title="People & places" eyebrow="CAMPUS">
          {[['Students', d.totalStudents], ['Vendors', d.totalVendors], ['Vendor applications waiting', d.pendingVendors], ['Outlets open / total', `${d.activeOutlets} / ${d.totalOutlets}`], ['Menu items available / total', `${d.availableFoodItems} / ${d.totalFoodItems}`]].map(([label, value]) => <div className="list-row" key={label as string}><div className="grow">{label}</div><span className="mono">{value}</span></div>)}
        </Panel>
      </div></>}
  </Page>
}
