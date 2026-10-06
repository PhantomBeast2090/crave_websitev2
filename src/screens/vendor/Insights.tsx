import { fetchVendorDashboard } from '../../lib/api/staff'
import { formatMoney } from '../../lib/pricing'
import { useAsync } from '../../state/useAsync'
import { ErrorState, LineChart, Metric, Page, PageHeading, Panel, Skeleton, RatingText } from '../../ui/kit'
import { OutletPicker, useVendor } from './context'

export function VendorInsights() {
  const { outletId } = useVendor()
  const dash = useAsync(() => fetchVendorDashboard(outletId), [outletId])
  const d = dash.data
  return <Page>
    <PageHeading eyebrow="INSIGHTS" title={<>Last 7 <em>days.</em></>} action={<OutletPicker />} />
    {dash.loading && !d ? <Skeleton rows={3} height={120} /> : dash.error ? <ErrorState message={dash.error} onRetry={dash.reload} /> : d && <>
      <div className="metric-grid"><Metric value={d.ordersToday} label="orders today" tone="tangerine" /><Metric value={formatMoney(d.revenueToday)} label="paid revenue today" tone="aqua" /><Metric value={d.activeOrders} label="active right now" tone="lavender" /><Metric value={d.completedToday} label="completed today" tone="chartreuse" /></div>
      <div className="panel-grid">
        <Panel title="Orders per day" eyebrow="TREND"><LineChart data={d.trend} valueKey="orders" label="Orders per day" /></Panel>
        <Panel title="Paid revenue per day" eyebrow="TREND"><LineChart data={d.trend} valueKey="revenue" label="Paid revenue per day" format={(v) => formatMoney(v)} tone="ink" /></Panel>
      </div>
      <Panel title="Outlets" eyebrow="PER OUTLET">{d.outlets.map((o) => <div className="list-row" key={o.id}><div className="grow"><span className="cell-title">{o.name}</span><span className="cell-sub">{o.ordersToday} orders today · {o.activeOrders} active</span></div><RatingText rating={o.rating} count={o.totalReviews} /></div>)}</Panel></>}
    <p className="muted" style={{ fontSize: 12 }}>Revenue counts only payments that have actually been received (online paid, or counter orders collected).</p>
  </Page>
}
