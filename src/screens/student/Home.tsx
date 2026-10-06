import { fetchCategories, fetchFoods, fetchOutlets } from '../../lib/api/catalog'
import { istNow } from '../../lib/time'
import { Link } from '../../state/router'
import { useAsync } from '../../state/useAsync'
import { EmptyState, ErrorState, Page, RatingText, Skeleton } from '../../ui/kit'
import { useReadyAuth } from '../../state/auth'
import type { Outlet } from '../../types'
import { FoodCard } from './FoodCard'

function greeting() {
  const hour = Number(istNow().time.slice(0, 2))
  return hour < 5 ? 'Late-night craving?' : hour < 11 ? 'Breakfast run?' : hour < 16 ? 'Lunch break?' : hour < 19 ? 'Snack o’clock?' : 'Late-night craving?'
}

export function OutletCard({ outlet, featured }: { outlet: Outlet; featured?: boolean }) {
  return <Link to={`/outlet/${outlet.id}`} className={`outlet-card tone-${outlet.tone} ${featured ? 'outlet-featured' : ''}`}>
    <div className="outlet-art">{outlet.imageUrl && <img src={outlet.imageUrl} alt="" loading="lazy" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.currentTarget.style.display = 'none' }} />}
      <span className="outlet-emoji" aria-hidden="true">{outlet.emoji}</span><span className="outlet-open">{outlet.isOpen ? 'OPEN' : 'CLOSED'}</span></div>
    <div className="outlet-card-body"><div><h3>{outlet.name}</h3><p>{outlet.location}</p></div>
      <div className="outlet-meta"><RatingText rating={outlet.rating} count={outlet.reviewCount} />{outlet.opensAt && <span className="hours-line">{outlet.opensAt}–{outlet.closesAt}</span>}</div></div>
  </Link>
}

export function HomePage() {
  const { profile } = useReadyAuth()
  const outlets = useAsync(fetchOutlets, [])
  const categories = useAsync(fetchCategories, [])
  const popular = useAsync(() => fetchFoods({ popularOnly: true, pageSize: 8, sort: 'rating' }), [])
  const today = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: '2-digit', month: 'long' }).format(new Date())
  const sorted = [...(outlets.data ?? [])].sort((a, b) => Number(b.isOpen) - Number(a.isOpen))

  return <Page className="page-home">
    <div className="home-intro"><div><span className="eyebrow orange-ink">{today.toUpperCase()}</span><h1>{greeting()}<br /><em>Make it count, {profile.name.split(' ')[0]}.</em></h1><p className="lede">Pick a pickup slot, grab your token, skip the queue.</p></div></div>

    <section className="section-block category-section" aria-labelledby="cats"><div className="section-heading"><div><span className="eyebrow">START HERE</span><h2 id="cats">What’s the vibe?</h2></div><Link className="text-button" to="/explore">see all eats <span aria-hidden="true">↗</span></Link></div>
      {categories.loading ? <Skeleton rows={1} height={44} /> : categories.error ? <ErrorState message={categories.error} onRetry={categories.reload} /> :
        <div className="filter-chips">{(categories.data ?? []).map((c) => <Link key={c.id} to={`/explore?category=${c.id}`} className="category-chip"><span aria-hidden="true">{c.emoji}</span>{c.label}</Link>)}</div>}
    </section>

    <section className="section-block" aria-labelledby="around"><div className="section-heading"><div><span className="eyebrow">AROUND CAMPUS</span><h2 id="around">Outlets <span className="heading-spark" aria-hidden="true">✦</span></h2></div></div>
      {outlets.loading ? <Skeleton rows={2} height={140} /> : outlets.error ? <ErrorState message={outlets.error} onRetry={outlets.reload} /> :
        sorted.length ? <div className="outlet-grid">{sorted.map((o) => <OutletCard key={o.id} outlet={o} />)}</div> : <EmptyState title="No outlets are open yet" copy="Check back soon — campus kitchens are warming up." />}
    </section>

    <section className="section-block bites-block" aria-labelledby="picks"><div className="section-heading"><div><span className="eyebrow">CAMPUS FAVOURITES</span><h2 id="picks">Popular right now</h2></div><Link className="text-button" to="/explore?sort=rating">more <span aria-hidden="true">↗</span></Link></div>
      {popular.loading ? <Skeleton rows={2} height={200} /> : popular.error ? <ErrorState message={popular.error} onRetry={popular.reload} /> :
        popular.data?.foods.length ? <div className="food-grid">{popular.data.foods.map((f) => <FoodCard key={f.id} food={f} />)}</div> : <EmptyState title="Nothing popular yet" copy="Order something and be the trend." action="Browse everything" onAction={() => window.location.assign('/explore')} />}
    </section>
  </Page>
}
