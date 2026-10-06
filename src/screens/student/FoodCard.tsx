import type { Food } from '../../types'
import { formatMoney } from '../../lib/pricing'
import { Link, useRouter } from '../../state/router'
import { FoodArt, RatingText } from '../../ui/kit'
import { useStudent } from './context'

export function FoodCard({ food }: { food: Food }) {
  const { favorites, toggleFavorite, requestAdd } = useStudent()
  const { navigate } = useRouter()
  const favorite = favorites.has(food.id)
  const soldOut = !food.isAvailable || food.stock === 0
  const needsChoices = food.groups.some((g) => g.isRequired)
  return <article className={`food-card tone-${food.tone}`}>
    <div className="food-image">
      <FoodArt item={food} className="food-art-fill" />
      <span className="food-tag">{food.tag || food.categoryName || 'campus classic'}</span>
      <button type="button" className={`heart-button ${favorite ? 'is-favorite' : ''}`} aria-pressed={favorite} aria-label={favorite ? `Remove ${food.name} from saved bites` : `Save ${food.name}`} onClick={() => toggleFavorite(food.id)}>{favorite ? '♥' : '♡'}</button>
      {soldOut && <span className="badge badge-ink sold-out">Sold out</span>}
    </div>
    <div className="food-card-body">
      <div>
        <h3><Link to={`/food/${food.id}`} className="food-title-link"><span className={`veg-dot ${food.isVeg ? '' : 'nonveg'}`} role="img" aria-label={food.isVeg ? 'Vegetarian' : 'Non-vegetarian'} />{food.name}</Link></h3>
        <p>{food.description}</p>
        {food.outletName && <p className="hours-line">{food.outletName}</p>}
        {food.stock !== null && food.stock > 0 && food.stock <= 5 && <p className="low-stock">Only {food.stock} left</p>}
      </div>
      <div className="food-card-footer">
        <strong>{formatMoney(food.price)}</strong><RatingText rating={food.rating} count={food.reviewCount} />
        <button type="button" className="add-button" disabled={soldOut} aria-label={needsChoices ? `Choose options for ${food.name}` : `Add ${food.name} to bag`}
          onClick={() => needsChoices ? navigate(`/food/${food.id}`) : requestAdd(food, 1)}>+</button>
      </div>
    </div>
  </article>
}
