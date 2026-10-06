import { useCallback, useEffect, useState } from 'react'
import { deleteFoodReply, deleteOutletReply, fetchVendorFoodReviews, fetchVendorOutletReviews, REVIEW_MAX, saveFoodReply, saveOutletReply, type Review } from '../../lib/api/reviews'
import { friendlyError, logError } from '../../lib/errors'
import { formatDateTime } from '../../lib/time'
import { useReadyAuth } from '../../state/auth'
import { useToast } from '../../state/toast'
import { EmptyState, ErrorState, Page, PageHeading, Skeleton, Stars, Tabs } from '../../ui/kit'
import { OutletPicker, useVendor } from './context'

type Kind = 'food' | 'outlet'

function ReviewRow({ review, kind, onChanged }: { review: Review; kind: Kind; onChanged: () => void }) {
  const { session } = useReadyAuth()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(review.reply?.text ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = kind === 'food' ? saveFoodReply : saveOutletReply
  const remove = kind === 'food' ? deleteFoodReply : deleteOutletReply

  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true); setError('')
    try { await fn(); toast.show(ok, 'green'); setEditing(false); onChanged() } catch (e) { logError('reply', e); setError(friendlyError(e, (e as Error).message || 'Could not save the reply.')) } finally { setBusy(false) }
  }

  return <article className="review-card">
    <div className="meta"><Stars value={review.rating} /><strong>{kind === 'food' ? review.foodName : review.outletName}</strong>{review.reviewer && <span>by {review.reviewer}</span>}<span>{formatDateTime(review.createdAt)}</span></div>
    {review.text ? <p>{review.text}</p> : <p className="muted">No written review.</p>}
    {review.reply && !editing && <div className="reply-box"><strong>Your reply</strong>{review.reply.text}
      <div className="row" style={{ marginTop: 8 }}><button type="button" className="button button-quiet small-button" onClick={() => setEditing(true)}>Edit reply</button>
        <button type="button" className="button button-danger small-button" disabled={busy} onClick={() => { if (review.reply?.id && window.confirm('Delete your reply?')) void run(() => remove(review.reply!.id!), 'Reply deleted') }}>Delete</button></div></div>}
    {(!review.reply || editing) && (editing || !review.reply) && (editing ? <form className="composer" onSubmit={(e) => { e.preventDefault(); void run(() => save({ reviewId: review.id, vendorId: session.user.id, text, existingId: review.reply?.id }), 'Reply saved') }}>
      <div className="field"><label htmlFor={`rp-${review.id}`}>Your reply (public)</label><textarea id={`rp-${review.id}`} value={text} maxLength={REVIEW_MAX} onChange={(e) => setText(e.target.value)} autoFocus /><div className="counter">{text.length}/{REVIEW_MAX}</div></div>
      {error && <p role="alert" className="field-error">{error}</p>}
      <div className="row"><button type="submit" className="button button-primary small-button" disabled={busy || !text.trim()}>{busy ? 'Saving…' : 'Post reply'}</button><button type="button" className="button button-quiet small-button" onClick={() => { setEditing(false); setText(review.reply?.text ?? '') }}>Cancel</button></div></form>
      : <div><button type="button" className="button button-light small-button" onClick={() => setEditing(true)}>Reply</button></div>)}
    {error && !editing && <p role="alert" className="field-error">{error}</p>}
  </article>
}

export function VendorReviews() {
  const { outletId } = useVendor()
  const [kind, setKind] = useState<Kind>('food')
  const [rows, setRows] = useState<Review[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => { setPage(0); setTick((t) => t + 1) }, [])

  useEffect(() => { setPage(0); setRows([]) }, [kind, outletId])
  useEffect(() => {
    let alive = true
    setState('loading')
    const load = kind === 'food' ? fetchVendorFoodReviews(page) : fetchVendorOutletReviews(outletId, page)
    load.then((r) => { if (!alive) return; setRows((prev) => page === 0 ? r.reviews : [...prev, ...r.reviews]); setTotal(r.total); setState('ready') })
      .catch((e) => { if (!alive) return; logError('vendor-reviews', e); setError(friendlyError(e, 'We could not load reviews.')); setState('error') })
    return () => { alive = false }
  }, [kind, page, outletId, tick])

  return <Page>
    <PageHeading eyebrow="REVIEWS" title={<>What students <em>say.</em></>} action={kind === 'outlet' ? <OutletPicker /> : undefined} />
    <Tabs label="Review type" value={kind} onChange={setKind} tabs={[{ id: 'food', label: 'Food reviews' }, { id: 'outlet', label: 'Outlet reviews' }]} />
    {state === 'loading' && !rows.length ? <Skeleton rows={3} height={100} /> : state === 'error' && !rows.length ? <ErrorState message={error} onRetry={reload} /> : !rows.length ? <EmptyState title="No reviews yet" copy="Reviews appear after students pick up their orders." /> :
      <div className="stack">{rows.map((r) => <ReviewRow key={`${kind}-${r.id}-${r.reply?.text ?? ''}`} review={r} kind={kind} onChanged={reload} />)}
        {rows.length < total && <button type="button" className="button button-light" disabled={state === 'loading'} onClick={() => setPage((p) => p + 1)}>{state === 'loading' ? 'Loading…' : 'Show more'}</button>}</div>}
  </Page>
}
