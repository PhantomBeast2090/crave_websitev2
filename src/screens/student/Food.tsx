import { useMemo, useState } from 'react'
import { fetchFood } from '../../lib/api/catalog'
import { fetchFoodReviews } from '../../lib/api/reviews'
import { MAX_LINE_QUANTITY, formatMoney } from '../../lib/pricing'
import type { CustomizationOption } from '../../types'
import { Link } from '../../state/router'
import { useAsync } from '../../state/useAsync'
import { Badge, EmptyState, ErrorState, FoodArt, Page, RatingText, Skeleton } from '../../ui/kit'
import { ReviewList } from './ReviewList'
import { useStudent } from './context'

export function FoodPage({ id }: { id: string }) {
  const food = useAsync(() => fetchFood(id), [id])
  const { favorites, toggleFavorite, requestAdd } = useStudent()
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [quantity, setQuantity] = useState(1)
  const [note, setNote] = useState('')
  const [triedAdd, setTriedAdd] = useState(false)

  const f = food.data
  const options = useMemo<CustomizationOption[]>(() => f ? f.groups.flatMap((g) => g.options.filter((o) => picked[g.id]?.includes(o.id))) : [], [f, picked])
  if (food.loading) return <Page><Skeleton rows={2} height={260} /></Page>
  if (food.error) return <Page><ErrorState message={food.error} onRetry={food.reload} /></Page>
  if (!f) return <Page><EmptyState title="That bite disappeared" copy="It may be sold out or no longer on the menu." action="Back to discovery" onAction={() => window.location.assign('/explore')} /></Page>

  const soldOut = !f.isAvailable || f.stock === 0
  const missing = f.groups.filter((g) => g.isRequired && !(picked[g.id]?.length))
  const unit = f.price + options.reduce((sum, o) => sum + o.extraPrice, 0)
  const maxQty = f.stock !== null && f.stock < MAX_LINE_QUANTITY ? Math.max(f.stock, 1) : MAX_LINE_QUANTITY
  const toggle = (groupId: string, optionId: string, max: number) => setPicked((current) => {
    const now = current[groupId] ?? []
    if (now.includes(optionId)) return { ...current, [groupId]: now.filter((x) => x !== optionId) }
    return { ...current, [groupId]: max === 1 ? [optionId] : now.length >= max ? now : [...now, optionId] }
  })
  const add = () => { setTriedAdd(true); if (missing.length) return; requestAdd(f, quantity, options, note, true) }

  return <Page className="page-food-detail">
    <Link to={`/outlet/${f.outletId}`} className="back-link"><span aria-hidden="true">←</span> back to {f.outletName ?? 'the outlet'}</Link>
    <div className="detail-layout">
      <div className={`detail-art tone-${f.tone}`}><FoodArt item={f} className="food-art-fill" /></div>
      <div className="detail-copy">
        <div className="detail-kicker"><Badge tone="orange">{f.tag || f.categoryName || 'campus classic'}</Badge><span className="detail-rating"><RatingText rating={f.rating} count={f.reviewCount} /> · ~{f.prepMinutes} min</span></div>
        <h1><span className={`veg-dot ${f.isVeg ? '' : 'nonveg'}`} role="img" aria-label={f.isVeg ? 'Vegetarian' : 'Non-vegetarian'} />{f.name}</h1>
        <p className="detail-description">{f.description}</p>
        <p className="hours-line">From <Link to={`/outlet/${f.outletId}`}><u>{f.outletName}</u></Link> · {formatMoney(f.price)}</p>
        {f.stock !== null && f.stock > 0 && f.stock <= 5 && <p className="low-stock">Only {f.stock} left</p>}
        {f.groups.length > 0 && <div className="detail-choice">
          {f.groups.map((g) => <fieldset key={g.id} className="customization-group" style={{ border: 0, padding: 0, margin: '0 0 14px' }}>
            <legend className="customization-group-label">{g.name}{g.isRequired ? ' · required' : ' · optional'}{g.maxSelections > 1 ? ` · up to ${g.maxSelections}` : ''}</legend>
            <div className="customization-list">{g.options.map((o) => { const on = picked[g.id]?.includes(o.id) ?? false
              return <button key={o.id} type="button" aria-pressed={on} className={`customization ${on ? 'customization-selected' : ''}`} onClick={() => toggle(g.id, o.id, g.maxSelections)}>
                <span className="customization-check" aria-hidden="true">{on ? '✓' : '+'}</span>{o.name}<strong>{o.extraPrice ? `+ ${formatMoney(o.extraPrice)}` : ''}</strong></button> })}</div>
          </fieldset>)}
        </div>}
        <div className="field"><label htmlFor="food-note">Note for the kitchen (optional)</label><input id="food-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Less spicy, no onions…" /><small>{note.length}/200</small></div>
        {triedAdd && missing.length > 0 && <p role="alert" className="field-error">Please choose: {missing.map((g) => g.name).join(', ')}.</p>}
        <div className="detail-actions">
          <div className="qty" role="group" aria-label="Quantity"><button type="button" aria-label="Decrease quantity" onClick={() => setQuantity((q) => Math.max(1, q - 1))}>−</button><span aria-live="polite">{quantity}</span><button type="button" aria-label="Increase quantity" onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))}>+</button></div>
          <button type="button" className="button button-primary add-detail" disabled={soldOut} onClick={add}>{soldOut ? 'Sold out' : <>Add to bag <span>{formatMoney(unit * quantity)} ↗</span></>}</button>
          <button type="button" className={`button button-light`} aria-pressed={favorites.has(f.id)} onClick={() => toggleFavorite(f.id)}>{favorites.has(f.id) ? '♥ Saved' : '♡ Save'}</button>
        </div>
        <p className="detail-footnote">Final price and availability are confirmed by Crave when you check out.</p>
      </div>
    </div>
    <section className="section-block" aria-labelledby="food-reviews"><div className="section-heading"><div><span className="eyebrow">WHAT STUDENTS SAY</span><h2 id="food-reviews">Reviews</h2></div></div>
      <ReviewList load={(page) => fetchFoodReviews(id, page)} empty="Nobody has reviewed this yet." /></section>
  </Page>
}
