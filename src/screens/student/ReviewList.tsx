import { useEffect, useState } from 'react'
import type { ReviewPage, Review } from '../../lib/api/reviews'
import { formatDateTime } from '../../lib/time'
import { friendlyError, logError } from '../../lib/errors'
import { EmptyState, ErrorState, Skeleton, Stars } from '../../ui/kit'

export function ReviewCard({ review }: { review: Review }) {
  return <article className="review-card">
    <div className="meta"><Stars value={review.rating} />{review.reviewer && <strong>{review.reviewer}</strong>}<span>{formatDateTime(review.createdAt)}</span>{review.mine && <span className="badge badge-blue">Yours</span>}</div>
    {review.text && <p>{review.text}</p>}
    {review.reply && <div className="reply-box"><strong>Reply from the outlet</strong>{review.reply.text}</div>}
  </article>
}

/** Paged, read-only list of public (visible) reviews. */
export function ReviewList({ load, empty }: { load: (page: number) => Promise<ReviewPage>; empty: string }) {
  const [reviews, setReviews] = useState<Review[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setState('loading')
    load(page).then((result) => { if (!alive) return; setReviews((prev) => page === 0 ? result.reviews : [...prev, ...result.reviews]); setTotal(result.total); setState('ready') })
      .catch((e) => { if (!alive) return; logError('reviews', e); setError(friendlyError(e, 'We could not load reviews.')); setState('error') })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, tick])

  if (state === 'loading' && !reviews.length) return <Skeleton rows={2} height={80} />
  if (state === 'error' && !reviews.length) return <ErrorState message={error} onRetry={() => setTick((t) => t + 1)} />
  if (!reviews.length) return <EmptyState title="No reviews yet" copy={empty} />
  return <div className="stack">{reviews.map((r) => <ReviewCard key={r.id} review={r} />)}
    {reviews.length < total && <button type="button" className="button button-light" disabled={state === 'loading'} onClick={() => setPage((p) => p + 1)}>{state === 'loading' ? 'Loading…' : 'Show more reviews'}</button>}
    {state === 'error' && <p role="alert" className="field-error">{error}</p>}</div>
}
