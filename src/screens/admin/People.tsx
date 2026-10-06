import { useState } from 'react'
import { fetchAdminOutlets, fetchUsers, setUserActive, setUserRole, type AdminUser } from '../../lib/api/staff'
import { friendlyError } from '../../lib/errors'
import { formatDateTime } from '../../lib/time'
import { useReadyAuth } from '../../state/auth'
import { useToast } from '../../state/toast'
import { useAsync, useDebounced } from '../../state/useAsync'
import { Badge, ConfirmDialog, EmptyState, ErrorState, Page, PageHeading, Pager, Skeleton, Tabs } from '../../ui/kit'

const roleLabel: Record<string, string> = { STUDENT: 'Student', VENDOR: 'Vendor', ADMIN: 'Management', PENDING_VENDOR: 'Vendor applicant' }

type Pending = { user: AdminUser; kind: 'approve' | 'revoke' | 'deactivate' | 'activate' | 'role'; role?: string }

function useUserActions(reload: () => void) {
  const toast = useToast()
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (!pending) return
    setBusy(true)
    try {
      if (pending.kind === 'approve') await setUserRole(pending.user.id, 'VENDOR')
      else if (pending.kind === 'revoke') await setUserRole(pending.user.id, 'STUDENT')
      else if (pending.kind === 'role') await setUserRole(pending.user.id, pending.role!)
      else await setUserActive(pending.user.id, pending.kind === 'activate')
      toast.show('Done', 'green'); setPending(null); reload()
    } catch (e) { toast.show(friendlyError(e, 'Could not make that change.'), 'red') } finally { setBusy(false) }
  }
  const dialog = pending && <ConfirmDialog title={{ approve: 'Approve vendor?', revoke: 'Decline application?', deactivate: 'Disable account?', activate: 'Re-enable account?', role: 'Change role?' }[pending.kind]} confirmLabel="Confirm" danger={pending.kind === 'deactivate' || pending.kind === 'revoke'} busy={busy} onClose={() => setPending(null)} onConfirm={() => void run()}
    body={<>{pending.user.name} ({pending.user.email}) {pending.kind === 'approve' ? 'will get the vendor workspace once an outlet is linked to them.' : pending.kind === 'revoke' ? 'will be returned to a regular student account.' : pending.kind === 'deactivate' ? 'will be signed out of everything and blocked.' : pending.kind === 'activate' ? 'will be able to sign in again.' : `will become ${roleLabel[pending.role!]}.`}</>} />
  return { setPending, dialog }
}

export function AdminUsers() {
  const { profile } = useReadyAuth()
  const [role, setRole] = useState('all')
  const [search, setSearch] = useState('')
  const q = useDebounced(search)
  const [page, setPage] = useState(0)
  const users = useAsync(() => fetchUsers({ role, search: q, page }), [role, q, page])
  const { setPending, dialog } = useUserActions(users.reload)
  return <Page>
    <PageHeading eyebrow="PEOPLE" title={<>Crave <em>users.</em></>} />
    <div className="filter-bar"><div className="grow field"><label htmlFor="au-q">Name or email</label><input id="au-q" type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }} maxLength={60} /></div>
      <div className="field"><label htmlFor="au-r">Role</label><select id="au-r" value={role} onChange={(e) => { setRole(e.target.value); setPage(0) }}><option value="all">All roles</option>{Object.entries(roleLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div></div>
    {users.loading && !users.data ? <Skeleton rows={5} height={52} /> : users.error ? <ErrorState message={users.error} onRetry={users.reload} /> : !users.data?.users.length ? <EmptyState title="No users match" /> : <>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Scrollable table"><table className="data-table"><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Joined</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>
        {users.data.users.map((u) => <tr key={u.id}><td><span className="cell-title">{u.name}</span><span className="cell-sub">{u.email}</span></td><td><Badge tone={u.role === 'ADMIN' ? 'ink' : u.role === 'VENDOR' ? 'orange' : u.role === 'PENDING_VENDOR' ? 'blue' : 'neutral'}>{roleLabel[u.role] ?? u.role}</Badge></td>
          <td>{u.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="red">Disabled</Badge>}</td><td>{formatDateTime(u.createdAt)}</td>
          <td>{u.id !== profile.id && <div className="row">{u.role === 'PENDING_VENDOR' && <button type="button" className="button button-primary small-button" onClick={() => setPending({ user: u, kind: 'approve' })}>Approve</button>}
            <button type="button" className={`button small-button ${u.isActive ? 'button-danger' : 'button-light'}`} onClick={() => setPending({ user: u, kind: u.isActive ? 'deactivate' : 'activate' })}>{u.isActive ? 'Disable' : 'Enable'}</button></div>}</td></tr>)}</tbody></table></div>
      <Pager page={page} pageSize={25} total={users.data.total} onPage={setPage} /></>}
    {dialog}
  </Page>
}

export function AdminVendors() {
  const [tab, setTab] = useState<'VENDOR' | 'PENDING_VENDOR'>('PENDING_VENDOR')
  const users = useAsync(() => fetchUsers({ role: tab, pageSize: 100 }), [tab])
  const outlets = useAsync(fetchAdminOutlets, [])
  const { setPending, dialog } = useUserActions(users.reload)
  const countFor = (id: string) => (outlets.data ?? []).filter((o) => o.vendorId === id)
  return <Page>
    <PageHeading eyebrow="PARTNERS" title={<>Vendors &amp; <em>applications.</em></>} />
    <Tabs label="Vendor list" value={tab} onChange={setTab} tabs={[{ id: 'PENDING_VENDOR', label: 'Applications' }, { id: 'VENDOR', label: 'Approved vendors' }]} />
    {users.loading && !users.data ? <Skeleton rows={3} height={60} /> : users.error ? <ErrorState message={users.error} onRetry={users.reload} /> : !users.data?.users.length ? <EmptyState title={tab === 'PENDING_VENDOR' ? 'No applications waiting' : 'No vendors yet'} /> :
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Scrollable table"><table className="data-table"><thead><tr><th>Vendor</th><th>Outlets</th><th>Applied</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>
        {users.data.users.map((u) => <tr key={u.id}><td><span className="cell-title">{u.name}</span><span className="cell-sub">{u.email}</span></td><td>{countFor(u.id).map((o) => o.name).join(', ') || <span className="muted">none linked</span>}</td><td>{formatDateTime(u.createdAt)}</td>
          <td><div className="row">{tab === 'PENDING_VENDOR' ? <><button type="button" className="button button-primary small-button" onClick={() => setPending({ user: u, kind: 'approve' })}>Approve</button><button type="button" className="button button-danger small-button" onClick={() => setPending({ user: u, kind: 'revoke' })}>Decline</button></> :
            <button type="button" className="button button-danger small-button" onClick={() => setPending({ user: u, kind: u.isActive ? 'deactivate' : 'activate' })}>{u.isActive ? 'Disable' : 'Enable'}</button>}</div></td></tr>)}</tbody></table></div>}
    {tab === 'PENDING_VENDOR' && <p className="muted" style={{ fontSize: 12 }}>Approving gives access to the vendor workspace. Link their outlet(s) in the database (outlets.vendor_id) so they have something to manage.</p>}
    {dialog}
  </Page>
}
