import { useState } from 'react'
import { adminSearchFoodReviews, adminSearchOutletReviews, setFoodReviewVisibility, setOutletReviewVisibility, type Review } from '../../lib/api/reviews'
import { fetchAdminOutlets } from '../../lib/api/staff'
import { friendlyError } from '../../lib/errors'
import { formatDateTime } from '../../lib/time'
import { useToast } from '../../state/toast'
import { useAsync, useDebounced } from '../../state/useAsync'
import { Badge, EmptyState, ErrorState, Page, PageHeading, Pager, Skeleton, Stars, Tabs } from '../../ui/kit'

export function AdminReviews() {
  const toast = useToast()
  const [kind, setKind] = useState<'food' | 'outlet'>('food')
  const [search, setSearch] = useState('')
  const q = useDebounced(search)
  const [visibility, setVisibility] = useState<'all' | 'visible' | 'hidden'>('all')
  const [rating, setRating] = useState('')
  const [outletId, setOutletId] = useState('')
  const [page, setPage] = useState(0)
  const outlets = useAsync(fetchAdminOutlets, [], kind === 'outlet')
  const reviews = useAsync(() => (kind === 'food' ? adminSearchFoodReviews : adminSearchOutletReviews)({ search: q, visibility, rating: rating ? Number(rating) : null, outletId: outletId || null, page }), [kind, q, visibility, rating, outletId, page])

  const moderate = async (r: Review, visible: boolean) => {
    try { await (kind === 'food' ? setFoodReviewVisibility : setOutletReviewVisibility)(r.id, visible); toast.show(visible ? 'Review restored' : 'Review hidden from students and vendors', 'ink'); reviews.reload() }
    catch (e) { toast.show(friendlyError(e, 'Could not update the review.'), 'red') }
  }
  return <Page>
    <PageHeading eyebrow="MODERATION" title={<>Keep reviews <em>honest.</em></>} />
    <Tabs label="Review type" value={kind} onChange={(k) => { setKind(k); setPage(0); setSearch(''); setRating(''); setOutletId(''); setVisibility('all') }} tabs={[{ id: 'food', label: 'Food reviews' }, { id: 'outlet', label: 'Outlet reviews' }]} />
    <div className="filter-bar"><div className="grow field"><label htmlFor="mr-q">Search text, student or {kind === 'food' ? 'food' : 'outlet'}</label><input id="mr-q" type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0) }} maxLength={60} /></div>
      <div className="field"><label htmlFor="mr-v">Visibility</label><select id="mr-v" value={visibility} onChange={(e) => { setVisibility(e.target.value as typeof visibility); setPage(0) }}><option value="all">All</option><option value="visible">Visible</option><option value="hidden">Hidden</option></select></div>
      <div className="field"><label htmlFor="mr-r">Rating</label><select id="mr-r" value={rating} onChange={(e) => { setRating(e.target.value); setPage(0) }}><option value="">Any</option>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} star{n > 1 ? 's' : ''}</option>)}</select></div>
      {kind === 'outlet' && <div className="field"><label htmlFor="mr-o">Outlet</label><select id="mr-o" value={outletId} onChange={(e) => { setOutletId(e.target.value); setPage(0) }}><option value="">All outlets</option>{(outlets.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>}</div>
    {reviews.loading && !reviews.data ? <Skeleton rows={3} height={100} /> : reviews.error ? <ErrorState message={reviews.error} onRetry={reviews.reload} /> : !reviews.data?.reviews.length ? <EmptyState title="No reviews match" /> : <>
      <div className="stack">{reviews.data.reviews.map((r) => <article className="review-card" key={r.id}>
        <div className="meta"><Stars value={r.rating} /><strong>{kind === 'food' ? r.foodName : r.outletName}</strong>{r.reviewer && <span>by {r.reviewer}</span>}<span>{formatDateTime(r.createdAt)}</span><Badge tone={r.isVisible === false ? 'red' : 'green'}>{r.isVisible === false ? 'Hidden' : 'Visible'}</Badge></div>
        {r.text ? <p>{r.text}</p> : <p className="muted">No written review.</p>}{r.reply && <div className="reply-box"><strong>Vendor reply</strong>{r.reply.text}</div>}
        <div><button type="button" className={`button small-button ${r.isVisible === false ? 'button-primary' : 'button-danger'}`} onClick={() => void moderate(r, r.isVisible === false)}>{r.isVisible === false ? 'Restore' : 'Hide'}</button></div></article>)}</div>
      <Pager page={page} pageSize={20} total={reviews.data.total} onPage={setPage} /></>}
  </Page>
}
