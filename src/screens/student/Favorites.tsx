import { fetchFavoriteFoods } from '../../lib/api/catalog'
import { useReadyAuth } from '../../state/auth'
import { useRouter } from '../../state/router'
import { useAsync } from '../../state/useAsync'
import { EmptyState, ErrorState, Page, PageHeading, Skeleton } from '../../ui/kit'
import { FoodCard } from './FoodCard'
import { useStudent } from './context'

export function FavoritesPage() {
  const { session } = useReadyAuth()
  const { navigate } = useRouter()
  const { favorites } = useStudent()
  const foods = useAsync(() => fetchFavoriteFoods(session.user.id), [session.user.id])
  const visible = (foods.data ?? []).filter((f) => favorites.has(f.id))   // un-hearting removes the card immediately
  return <Page className="page-favorites">
    <PageHeading eyebrow="YOUR LITTLE BLACK BOOK" title={<>Saved<br /><em>bites.</em></>} />
    {foods.loading && !foods.data ? <Skeleton rows={2} height={220} /> : foods.error ? <ErrorState message={foods.error} onRetry={foods.reload} /> :
      visible.length ? <div className="food-grid">{visible.map((f) => <FoodCard key={f.id} food={f} />)}</div> :
      <EmptyState title="Nothing saved yet" copy="Tap the little heart on a food card when the vibes are right." action="Browse the menu" onAction={() => navigate('/explore')} />}
  </Page>
}
