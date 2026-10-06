import { useState } from 'react'
import { fetchAdminOutlets, fetchSlots, fetchStaffFoods, setFoodAvailability, setOutletFlags, setSlotCapacity, type AdminSlot, type StaffFood } from '../../lib/api/staff'
import { friendlyError } from '../../lib/errors'
import { formatMoney } from '../../lib/pricing'
import { formatTime12, istToday } from '../../lib/time'
import { useToast } from '../../state/toast'
import { useAsync, useDebounced } from '../../state/useAsync'
import { Badge, Dialog, EmptyState, ErrorState, Page, PageHeading, Pager, RatingText, Skeleton } from '../../ui/kit'
import { FoodEditor } from '../vendor/Menu'

export function AdminOutlets() {
  const toast = useToast()
  const outlets = useAsync(fetchAdminOutlets, [])
  const set = async (id: string, flags: { is_open?: boolean; is_active?: boolean }) => {
    try { await setOutletFlags(id, flags); outlets.reload() } catch (e) { toast.show(friendlyError(e, 'Could not update the outlet.'), 'red') }
  }
  return <Page>
    <PageHeading eyebrow="PLACES" title={<>Campus <em>outlets.</em></>} />
    {outlets.loading && !outlets.data ? <Skeleton rows={4} height={60} /> : outlets.error ? <ErrorState message={outlets.error} onRetry={outlets.reload} /> : !outlets.data?.length ? <EmptyState title="No outlets" /> :
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Scrollable table"><table className="data-table"><thead><tr><th>Outlet</th><th>Vendor</th><th>Rating</th><th>Open now</th><th>Listed</th></tr></thead><tbody>
        {outlets.data.map((o) => <tr key={o.id}><td><span className="cell-title">{o.name}</span><span className="cell-sub">{o.location}{o.opensAt ? ` · ${o.opensAt}–${o.closesAt}` : ''}</span></td><td>{o.vendorName ?? '—'}</td><td><RatingText rating={o.rating} count={o.reviewCount} /></td>
          <td><button type="button" role="switch" aria-checked={o.isOpen} aria-label={`${o.name} open`} className="switch" onClick={() => void set(o.id, { is_open: !o.isOpen })} /></td>
          <td><button type="button" role="switch" aria-checked={o.isActive} aria-label={`${o.name} listed on Crave`} className="switch" onClick={() => void set(o.id, { is_active: !o.isActive })} /></td></tr>)}</tbody></table></div>}
    <p className="muted" style={{ fontSize: 12 }}>“Open now” controls same-day ordering. “Listed” removes the outlet from the student app entirely.</p>
  </Page>
}

export function AdminMenu({ lowOnly }: { lowOnly?: boolean }) {
  const toast = useToast()
  const [outletId, setOutletId] = useState('')
  const [search, setSearch] = useState('')
  const q = useDebounced(search)
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<StaffFood | null>(null)
  const outlets = useAsync(fetchAdminOutlets, [])
  const foods = useAsync(() => fetchStaffFoods({ outletId: outletId || null, search: q, page, pageSize: 30 }), [outletId, q, page])
  const rows = (foods.data?.foods ?? []).filter((f) => !lowOnly || (f.stock !== null && f.stock <= f.lowStockAt))
  const toggle = async (f: StaffFood) => { try { await setFoodAvailability(f.id, !f.isAvailable); foods.reload() } catch (e) { toast.show(friendlyError(e, 'Could not change availability.'), 'red') } }
  return <Page>
    <PageHeading eyebrow={lowOnly ? 'STOCK' : 'CATALOGUE'} title={lowOnly ? <>Inventory <em>watch.</em></> : <>The whole <em>menu.</em></>} />
    <div className="filter-bar"><div className="grow field"><label htmlFor="am-q">Search items</label><input id="am-q" type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }} maxLength={60} /></div>
      <div className="field"><label htmlFor="am-o">Outlet</label><select id="am-o" value={outletId} onChange={(e) => { setOutletId(e.target.value); setPage(0) }}><option value="">All outlets</option>{(outlets.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div></div>
    {foods.loading && !foods.data ? <Skeleton rows={5} height={52} /> : foods.error ? <ErrorState message={foods.error} onRetry={foods.reload} /> : !rows.length ? <EmptyState title={lowOnly ? 'Nothing is running low on this page' : 'No items found'} copy={lowOnly ? 'Try the next page or another outlet.' : undefined} /> : <>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Scrollable table"><table className="data-table"><thead><tr><th>Item</th><th>Outlet</th><th className="num">Price</th><th className="num">Stock</th><th>Available</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>
        {rows.map((f) => <tr key={f.id}><td><span className="cell-title">{f.name}</span><span className="cell-sub">{f.category}</span></td><td>{f.outletName}</td><td className="num">{formatMoney(f.price)}</td>
          <td className="num">{f.stock === null ? '—' : f.stock > 10000 ? '∞' : <>{f.stock}{f.stock <= f.lowStockAt && <> <Badge tone="red">low</Badge></>}</>}</td>
          <td><button type="button" role="switch" aria-checked={f.isAvailable} aria-label={`${f.name} available`} className="switch" onClick={() => void toggle(f)} /></td>
          <td><button type="button" className="button button-light small-button" onClick={() => setEditing(f)}>Edit</button></td></tr>)}</tbody></table></div>
      <Pager page={page} pageSize={30} total={foods.data?.total ?? 0} onPage={setPage} /></>}
    {editing && <FoodEditor food={editing} onClose={() => setEditing(null)} onSaved={foods.reload} />}
  </Page>
}

function SlotEditor({ slot, onClose, onSaved }: { slot: AdminSlot; onClose: () => void; onSaved: () => void }) {
  const toast = useToast()
  const [capacity, setCapacity] = useState(String(slot.capacity))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => { setBusy(true); setError(''); try { await setSlotCapacity(slot.id, Number(capacity), slot.bookedCount); toast.show('Capacity updated', 'green'); onSaved(); onClose() } catch (e) { setError(friendlyError(e, (e as Error).message)) } finally { setBusy(false) } }
  return <Dialog title={`${slot.outletName} · ${formatTime12(slot.startTime)}`} onClose={onClose} actions={<><button type="button" className="button button-light" onClick={onClose}>Cancel</button><button type="button" className="button button-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button></>}>
    <p className="muted">{slot.bookedCount} already booked — capacity can't go below that.</p>
    <div className="field"><label htmlFor="se-c">Capacity (orders per slot)</label><input id="se-c" type="number" min={Math.max(1, slot.bookedCount)} max={500} step={1} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></div>
    {error && <p role="alert" className="field-error">{error}</p>}
  </Dialog>
}

export function AdminSlots() {
  const [date, setDate] = useState(istToday())
  const [outletId, setOutletId] = useState('')
  const [editing, setEditing] = useState<AdminSlot | null>(null)
  const outlets = useAsync(fetchAdminOutlets, [])
  const slots = useAsync(() => fetchSlots({ outletId: outletId || null, date }), [date, outletId])
  return <Page>
    <PageHeading eyebrow="CAPACITY" title={<>Pickup <em>slots.</em></>} />
    <div className="filter-bar"><div className="field"><label htmlFor="as-d">Date</label><input id="as-d" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div>
      <div className="grow field"><label htmlFor="as-o">Outlet</label><select id="as-o" value={outletId} onChange={(e) => setOutletId(e.target.value)}><option value="">All outlets</option>{(outlets.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div></div>
    {slots.loading && !slots.data ? <Skeleton rows={4} height={50} /> : slots.error ? <ErrorState message={slots.error} onRetry={slots.reload} /> : !slots.data?.length ? <EmptyState title="No slots on that day" /> :
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Scrollable table"><table className="data-table"><thead><tr><th>Outlet</th><th>Time</th><th className="num">Booked</th><th className="num">Capacity</th><th>Status</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>
        {slots.data.map((s) => <tr key={s.id}><td>{s.outletName}</td><td>{formatTime12(s.startTime)} – {formatTime12(s.endTime)}</td><td className="num">{s.bookedCount}</td><td className="num">{s.capacity}</td>
          <td><Badge tone={s.status === 'FULL' ? 'red' : s.status === 'LIMITED' ? 'orange' : 'green'}>{s.status}</Badge></td><td><button type="button" className="button button-light small-button" onClick={() => setEditing(s)}>Edit</button></td></tr>)}</tbody></table></div>}
    {editing && <SlotEditor slot={editing} onClose={() => setEditing(null)} onSaved={slots.reload} />}
  </Page>
}
