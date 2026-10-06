import { useEffect, useState } from 'react'
import { fetchCategories, fetchFoods, fetchOutlets, type FoodSort } from '../../lib/api/catalog'
import { useRouter } from '../../state/router'
import { useAsync, useDebounced } from '../../state/useAsync'
import { EmptyState, ErrorState, Page, PageHeading, Pager, Skeleton } from '../../ui/kit'
import { FoodCard } from './FoodCard'

const PAGE_SIZE = 24
const sorts: { id: FoodSort; label: string }[] = [{ id: 'popular', label: 'Popular' }, { id: 'rating', label: 'Top rated' }, { id: 'price_asc', label: 'Price: low to high' }, { id: 'price_desc', label: 'Price: high to low' }, { id: 'name', label: 'A–Z' }]

/** Search / category / outlet / diet / sort — every filter runs in the database, never in the browser. */
export function ExplorePage({ outletId }: { outletId?: string }) {
  const { query, navigate, path } = useRouter()
  const [search, setSearch] = useState(query.get('q') ?? '')
  const debounced = useDebounced(search, 350)
  const category = query.get('category') ?? ''
  const outlet = outletId ?? query.get('outlet') ?? ''
  const diet = query.get('diet') ?? ''
  const sort = (query.get('sort') as FoodSort) || 'popular'
  const page = Math.max(0, Number(query.get('page') ?? 0) || 0)

  useEffect(() => { setSearch(query.get('q') ?? '') }, [query])   // header search / deep links
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(query)
    value ? next.set(key, value) : next.delete(key)
    if (key !== 'page') next.delete('page')
    navigate(`${path}${next.toString() ? `?${next}` : ''}`, { replace: true })
  }
  useEffect(() => { if (debounced !== (query.get('q') ?? '')) setParam('q', debounced.trim()) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [debounced])

  const categories = useAsync(fetchCategories, [])
  const outlets = useAsync(fetchOutlets, [], !outletId)
  const foods = useAsync(() => fetchFoods({ search: query.get('q') ?? '', categoryId: category || undefined, outletId: outlet || undefined, veg: diet === 'veg' ? true : diet === 'nonveg' ? false : null, sort, page, pageSize: PAGE_SIZE }),
    [query.get('q'), category, outlet, diet, sort, page])

  return <Page>
    {!outletId && <PageHeading eyebrow="EXPLORE" title={<>Find your <em>bite.</em></>} />}
    <form className="filter-bar" role="search" onSubmit={(e) => e.preventDefault()}>
      <div className="grow field"><label htmlFor="ex-q">Search</label><input id="ex-q" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Biryani, dosa, cold coffee…" maxLength={60} /></div>
      <div className="field"><label htmlFor="ex-cat">Category</label><select id="ex-cat" value={category} onChange={(e) => setParam('category', e.target.value)}><option value="">All categories</option>{(categories.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
      {!outletId && <div className="field"><label htmlFor="ex-out">Outlet</label><select id="ex-out" value={outlet} onChange={(e) => setParam('outlet', e.target.value)}><option value="">All outlets</option>{(outlets.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>}
      <div className="field"><label htmlFor="ex-diet">Diet</label><select id="ex-diet" value={diet} onChange={(e) => setParam('diet', e.target.value)}><option value="">Veg &amp; non-veg</option><option value="veg">Vegetarian</option><option value="nonveg">Non-vegetarian</option></select></div>
      <div className="field"><label htmlFor="ex-sort">Sort by</label><select id="ex-sort" value={sort} onChange={(e) => setParam('sort', e.target.value === 'popular' ? '' : e.target.value)}>{sorts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></div>
    </form>
    <p className="muted" role="status" aria-live="polite" style={{ fontSize: 13 }}>{foods.loading ? 'Searching…' : foods.data ? `${foods.data.total} item${foods.data.total === 1 ? '' : 's'} found` : ''}</p>
    {foods.loading && !foods.data ? <Skeleton rows={3} height={220} /> : foods.error ? <ErrorState message={foods.error} onRetry={foods.reload} /> :
      foods.data?.foods.length ? <><div className="food-grid">{foods.data.foods.map((f) => <FoodCard key={f.id} food={f} />)}</div><Pager page={page} pageSize={PAGE_SIZE} total={foods.data.total} onPage={(p) => setParam('page', p ? String(p) : '')} /></> :
      <EmptyState title="Nothing matches that" copy="Try a different word, or clear a filter." action="Clear filters" onAction={() => navigate(path)} />}
  </Page>
}
