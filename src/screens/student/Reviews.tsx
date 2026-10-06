import { useState } from 'react'
import { deleteFoodReview, deleteOutletReview, fetchMyFoodReviews, fetchMyOutletReview, REVIEW_MAX, saveFoodReview, saveOutletReview, type Review } from '../../lib/api/reviews'
import { friendlyError, logError } from '../../lib/errors'
import { formatDateTime } from '../../lib/time'
import type { Order } from '../../types'
import { useReadyAuth } from '../../state/auth'
import { useToast } from '../../state/toast'
import { useAsync } from '../../state/useAsync'
import { ErrorState, Skeleton, Stars } from '../../ui/kit'

function Composer({ title, existing, onSave, onDelete }: { title: string; existing?: Review | null; onSave: (rating: number, text: string) => Promise<void>; onDelete: () => Promise<void> }) {
  const toast = useToast()
  const [editing, setEditing] = useState(!existing)
  const [rating, setRating] = useState(existing?.rating ?? 0)
  const [text, setText] = useState(existing?.text ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true); setError('')
    try { await action(); toast.show(success, 'green'); setEditing(false) } catch (e) { logError('review', e); setError(friendlyError(e, 'Could not save your review.')) } finally { setBusy(false) }
  }

  if (existing && !editing) return <article className="review-card">
    <div className="row-between"><strong>{title}</strong><div className="row"><button type="button" className="button button-quiet small-button" onClick={() => setEditing(true)}>Edit</button>
      <button type="button" className="button button-danger small-button" disabled={busy} onClick={() => { if (window.confirm('Delete your review?')) void run(onDelete, 'Review deleted') }}>Delete</button></div></div>
    <div className="meta"><Stars value={existing.rating} /><span>{formatDateTime(existing.createdAt)}</span></div>
    {existing.text && <p>{existing.text}</p>}
    {existing.reply && <div className="reply-box"><strong>Reply from the outlet</strong>{existing.reply.text}</div>}
    {error && <p role="alert" className="field-error">{error}</p>}
  </article>

  return <form className="composer" onSubmit={(e) => { e.preventDefault(); if (!rating) return setError('Choose a star rating.'); void run(() => onSave(rating, text), existing ? 'Review updated' : 'Thanks for your review!') }}>
    <strong>{title}</strong>
    <Stars value={rating} onChange={setRating} label={`Rating for ${title}`} />
    <div className="field"><label htmlFor={`rv-${title}`} className="visually-hidden">Review text</label>
      <textarea id={`rv-${title}`} value={text} maxLength={REVIEW_MAX} onChange={(e) => setText(e.target.value)} placeholder="Tell others what you thought (optional)" /><div className="counter">{text.length}/{REVIEW_MAX}</div></div>
    {error && <p role="alert" className="field-error">{error}</p>}
    <div className="row"><button type="submit" className="button button-primary small-button" disabled={busy}>{busy ? 'Saving…' : existing ? 'Update review' : 'Post review'}</button>
      {existing && <button type="button" className="button button-quiet small-button" onClick={() => { setEditing(false); setRating(existing.rating); setText(existing.text) }}>Cancel</button>}</div>
  </form>
}

/** Only rendered for PICKED_UP orders; the database enforces the same rule. */
export function OrderReviews({ order }: { order: Order }) {
  const { session } = useReadyAuth()
  const userId = session.user.id
  const food = useAsync(() => fetchMyFoodReviews(order.id), [order.id])
  const outlet = useAsync(() => fetchMyOutletReview(order.id), [order.id])
  if (food.loading || outlet.loading) return <Skeleton rows={2} height={90} />
  if (food.error || outlet.error) return <ErrorState message={food.error || outlet.error} onRetry={() => { food.reload(); outlet.reload() }} />
  return <div className="stack">
    <h3 style={{ margin: 0 }}>How was {order.outletName}?</h3>
    <Composer key={`o-${outlet.data?.id ?? 'new'}-${outlet.data?.rating}-${outlet.data?.text}`} title={`Rate ${order.outletName}`} existing={outlet.data}
      onSave={async (rating, text) => { await saveOutletReview({ userId, orderId: order.id, outletId: order.outletId, rating, text, existingId: outlet.data?.id }); outlet.reload() }}
      onDelete={async () => { await deleteOutletReview(outlet.data!.id); outlet.reload() }} />
    <h3 style={{ margin: '10px 0 0' }}>Rate what you ordered</h3>
    {order.items.map((item) => { const existing = food.data?.get(item.id)
      return <Composer key={`${item.id}-${existing?.id ?? 'new'}-${existing?.rating}-${existing?.text}`} title={item.name} existing={existing}
        onSave={async (rating, text) => { await saveFoodReview({ userId, orderId: order.id, orderItemId: item.id, foodId: item.foodItemId, rating, text, existingId: existing?.id }); food.reload() }}
        onDelete={async () => { await deleteFoodReview(existing!.id); food.reload() }} /> })}
  </div>
}
