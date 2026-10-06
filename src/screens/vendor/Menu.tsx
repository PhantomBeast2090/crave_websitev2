import { useState } from 'react'
import { fetchStaffFoods, setFoodAvailability, setFoodPrice, setStock, type StaffFood } from '../../lib/api/staff'
import { friendlyError } from '../../lib/errors'
import { formatMoney } from '../../lib/pricing'
import { useToast } from '../../state/toast'
import { useAsync, useDebounced } from '../../state/useAsync'
import { Badge, Dialog, EmptyState, ErrorState, Page, PageHeading, Pager, Skeleton } from '../../ui/kit'
import { OutletPicker, useVendor } from './context'

export function FoodEditor({ food, onClose, onSaved, canPrice = true }: { food: StaffFood; onClose: () => void; onSaved: () => void; canPrice?: boolean }) {
  const toast = useToast()
  const [price, setPrice] = useState(String(food.price))
  const [stock, setStockValue] = useState(food.stock === null ? '' : String(food.stock))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    setBusy(true); setError('')
    try {
      if (canPrice && Number(price) !== food.price) await setFoodPrice(food.id, Number(price))
      if (stock !== '' && Number(stock) !== food.stock) await setStock(food.id, Number(stock))
      toast.show('Saved', 'green'); onSaved(); onClose()
    } catch (e) { setError(friendlyError(e, (e as Error).message || 'Could not save.')) } finally { setBusy(false) }
  }
  return <Dialog title={food.name} onClose={onClose} actions={<><button type="button" className="button button-light" onClick={onClose}>Cancel</button><button type="button" className="button button-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button></>}>
    <div className="stack">
      {canPrice && <div className="field"><label htmlFor="fe-price">Price (₹)</label><input id="fe-price" type="number" min="1" max="10000" step="0.5" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} /></div>}
      <div className="field"><label htmlFor="fe-stock">Units in stock</label><input id="fe-stock" type="number" min="0" max="1000000" step="1" inputMode="numeric" value={stock} onChange={(e) => setStockValue(e.target.value)} /><small>Orders are blocked when this reaches 0. Very large numbers mean “unlimited”.</small></div>
      {error && <p role="alert" className="field-error">{error}</p>}
    </div>
  </Dialog>
}

export function VendorMenu() {
  const { outletId } = useVendor()
  const toast = useToast()
  const [search, setSearch] = useState('')
  const q = useDebounced(search)
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<StaffFood | null>(null)
  const foods = useAsync(() => fetchStaffFoods({ outletId, search: q, page }), [outletId, q, page])
  const toggle = async (f: StaffFood) => {
    try { await setFoodAvailability(f.id, !f.isAvailable); foods.reload() } catch (e) { toast.show(friendlyError(e, 'Could not change availability.'), 'red') }
  }
  return <Page>
    <PageHeading eyebrow="MENU & STOCK" title={<>Your <em>menu.</em></>} action={<OutletPicker />} />
    <div className="filter-bar"><div className="grow field"><label htmlFor="vm-q">Search your items</label><input id="vm-q" type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }} maxLength={60} /></div></div>
    {foods.loading && !foods.data ? <Skeleton rows={5} height={52} /> : foods.error ? <ErrorState message={foods.error} onRetry={foods.reload} /> : !foods.data?.foods.length ? <EmptyState title="No items found" /> : <>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Scrollable table"><table className="data-table"><thead><tr><th>Item</th><th>Outlet</th><th className="num">Price</th><th className="num">Stock</th><th>Available</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>
        {foods.data.foods.map((f) => <tr key={f.id}><td><span className="cell-title">{f.name}</span><span className="cell-sub">{f.category}</span></td><td>{f.outletName}</td><td className="num">{formatMoney(f.price)}</td>
          <td className="num">{f.stock === null ? '—' : f.stock > 10000 ? '∞' : <>{f.stock}{f.stock <= f.lowStockAt && <> <Badge tone="red">low</Badge></>}</>}</td>
          <td><button type="button" role="switch" aria-checked={f.isAvailable} aria-label={`${f.name} available`} className="switch" onClick={() => void toggle(f)} /></td>
          <td><button type="button" className="button button-light small-button" onClick={() => setEditing(f)}>Edit</button></td></tr>)}</tbody></table></div>
      <Pager page={page} pageSize={30} total={foods.data.total} onPage={setPage} /></>}
    {editing && <FoodEditor food={editing} onClose={() => setEditing(null)} onSaved={foods.reload} />}
  </Page>
}
