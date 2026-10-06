import { createContext, useContext, useState, type ReactNode } from 'react'
import { fetchVendorOutlets } from '../../lib/api/staff'
import type { Outlet } from '../../types'
import { useAsync } from '../../state/useAsync'
import { ErrorState, Page, Skeleton, EmptyState } from '../../ui/kit'

type VendorOutlet = Outlet & { isActive: boolean }
type Ctx = { outlets: VendorOutlet[]; outletId: string | null; setOutletId: (id: string | null) => void; reloadOutlets: () => void }
const VendorCtx = createContext<Ctx | null>(null)

export function VendorProvider({ vendorId, children }: { vendorId: string; children: ReactNode }) {
  const outlets = useAsync(() => fetchVendorOutlets(vendorId), [vendorId])
  const [outletId, setOutletId] = useState<string | null>(null)
  if (outlets.loading && !outlets.data) return <Page><Skeleton rows={2} height={120} /></Page>
  if (outlets.error) return <Page><ErrorState message={outlets.error} onRetry={outlets.reload} /></Page>
  if (!outlets.data?.length) return <Page><EmptyState title="No outlets assigned yet" copy="Campus management hasn't linked an outlet to your vendor account. Ask them to assign one." /></Page>
  return <VendorCtx.Provider value={{ outlets: outlets.data, outletId, setOutletId, reloadOutlets: outlets.reload }}>{children}</VendorCtx.Provider>
}

export function useVendor() {
  const ctx = useContext(VendorCtx)
  if (!ctx) throw new Error('useVendor outside VendorProvider')
  return ctx
}

/** Outlet switcher: a vendor with several outlets sees all of them, or can focus on one. */
export function OutletPicker() {
  const { outlets, outletId, setOutletId } = useVendor()
  if (outlets.length < 2) return <span className="badge">{outlets[0].name}</span>
  return <div className="field" style={{ minWidth: 220 }}><label htmlFor="vp-outlet" className="visually-hidden">Outlet</label>
    <select id="vp-outlet" value={outletId ?? ''} onChange={(e) => setOutletId(e.target.value || null)}><option value="">All my outlets ({outlets.length})</option>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
}
