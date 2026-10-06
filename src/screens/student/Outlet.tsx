import { useState } from 'react'
import { fetchOutlet } from '../../lib/api/catalog'
import { fetchOutletReviews } from '../../lib/api/reviews'
import { Link } from '../../state/router'
import { useAsync } from '../../state/useAsync'
import { Badge, EmptyState, ErrorState, Page, RatingText, Skeleton, Tabs } from '../../ui/kit'
import { ExplorePage } from './Explore'
import { ReviewList } from './ReviewList'

export function OutletPage({ id }: { id: string }) {
  const outlet = useAsync(() => fetchOutlet(id), [id])
  const [tab, setTab] = useState<'menu' | 'reviews'>('menu')
  if (outlet.loading) return <Page><Skeleton rows={2} height={160} /></Page>
  if (outlet.error) return <Page><ErrorState message={outlet.error} onRetry={outlet.reload} /></Page>
  const o = outlet.data
  if (!o) return <Page><EmptyState title="That outlet isn't available" copy="It may be closed for good or no longer on Crave." action="Back to discovery" onAction={() => window.location.assign('/')} /></Page>
  return <Page className="page-menu">
    <Link to="/" className="back-link"><span aria-hidden="true">←</span> back to discovery</Link>
    <section className={`menu-cover tone-${o.tone}`}>
      <div><Badge tone={o.isOpen ? 'green' : 'red'}>{o.isOpen ? 'OPEN NOW' : 'CLOSED RIGHT NOW'}</Badge><h1>{o.name}</h1><p>{o.description}</p>
        <div className="menu-cover-meta"><RatingText rating={o.rating} count={o.reviewCount} /><span>{o.location}</span>{o.opensAt && <span>Hours {o.opensAt} – {o.closesAt}</span>}</div>
        {!o.isOpen && <p><strong>You can still pre-order for a later slot.</strong></p>}</div>
      <div className="menu-hero-emoji" aria-hidden="true">{o.emoji}</div>
    </section>
    <div style={{ marginTop: 22 }}><Tabs label="Outlet sections" value={tab} onChange={setTab} tabs={[{ id: 'menu', label: 'Menu' }, { id: 'reviews', label: 'Reviews', count: o.reviewCount }]} /></div>
    {tab === 'menu' ? <ExplorePage outletId={id} /> : <ReviewList load={(page) => fetchOutletReviews(id, page)} empty="No reviews yet — be the first after you pick up an order." />}
  </Page>
}
