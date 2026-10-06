import { useEffect, useId, useRef, type ReactNode } from 'react'
import type { Food, CartLine, Tone } from '../types'
import { formatMoney } from '../lib/pricing'

export function Page({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`page ${className}`}>{children}</div>
}

export function PageHeading({ eyebrow, title, action, children }: { eyebrow?: string; title: ReactNode; action?: ReactNode; children?: ReactNode }) {
  return <div className="page-heading-row">
    <div>{eyebrow && <span className="eyebrow orange-ink">{eyebrow}</span>}<h1>{title}</h1>{children}</div>
    {action}
  </div>
}

export function Panel({ title, eyebrow, action, children, className = '' }: { title?: ReactNode; eyebrow?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`ops-panel ${className}`}>
    {(title || eyebrow || action) && <div className="panel-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}{title && <h2>{title}</h2>}</div>{action}</div>}
    {children}
  </section>
}

export function Metric({ value, label, hint, tone = 'tangerine' }: { value: ReactNode; label: string; hint?: string; tone?: Tone }) {
  return <div className={`metric-card tone-${tone}`}><span className="metric-value">{value}</span><span className="metric-label">{label}</span>{hint && <span className="metric-delta">{hint}</span>}</div>
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'orange' | 'green' | 'red' | 'blue' | 'ink'; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div className="loading-block" role="status" aria-live="polite"><span className="spinner" aria-hidden="true" /><span>{label}…</span></div>
}

export function Skeleton({ rows = 3, height = 74 }: { rows?: number; height?: number }) {
  return <div className="skeleton-stack" aria-busy="true" aria-label="Loading">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ height }} />)}</div>
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="error-state" role="alert"><strong>Couldn't load this</strong><p>{message}</p>{onRetry && <button type="button" className="button button-dark" onClick={onRetry}>Try again</button>}</div>
}

export function EmptyState({ title, copy, action, onAction }: { title: string; copy?: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><div className="empty-shape" aria-hidden="true">✦</div><h2>{title}</h2>{copy && <p>{copy}</p>}{action && <button type="button" className="button button-primary" onClick={onAction}>{action} <span aria-hidden="true">↗</span></button>}</div>
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (id: T) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const onKey = (event: React.KeyboardEvent, index: number) => {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length : -1
    if (next >= 0) { event.preventDefault(); onChange(tabs[next].id); refs.current[next]?.focus() }
  }
  return <div className="tabs" role="tablist" aria-label={label}>
    {tabs.map((tab, index) => <button key={tab.id} ref={(el) => { refs.current[index] = el }} type="button" role="tab" aria-selected={value === tab.id} tabIndex={value === tab.id ? 0 : -1}
      className={`tab ${value === tab.id ? 'tab-active' : ''}`} onClick={() => onChange(tab.id)} onKeyDown={(e) => onKey(e, index)}>{tab.label}{tab.count !== undefined && <span className="tab-count">{tab.count}</span>}</button>)}
  </div>
}

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (total <= pageSize) return null
  return <nav className="pager" aria-label="Pagination">
    <button type="button" className="button button-light small-button" disabled={page === 0} onClick={() => onPage(page - 1)}>← Prev</button>
    <span>Page {page + 1} of {pages} · {total} total</span>
    <button type="button" className="button button-light small-button" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Next →</button>
  </nav>
}

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (id: string, describedBy?: string) => ReactNode }) {
  const id = useId(); const noteId = `${id}-note`
  return <div className="field"><label htmlFor={id}>{label}</label>{children(id, hint || error ? noteId : undefined)}{(hint || error) && <small id={noteId} className={error ? 'field-error' : ''} role={error ? 'alert' : undefined}>{error || hint}</small>}</div>
}

export function Dialog({ title, onClose, children, actions, wide }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const node = ref.current!
    const focusables = () => Array.from(node.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((el) => !el.hasAttribute('disabled'))
    ;(focusables()[0] ?? node).focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); onClose() }
      if (event.key === 'Tab') {
        const items = focusables(); if (!items.length) return
        const first = items[0], last = items[items.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    const { overflow } = document.body.style; document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = overflow; previous?.focus() }
  }, [onClose])
  return <div className="dialog-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <div ref={ref} className={`dialog ${wide ? 'dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <div className="dialog-head"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">✕</button></div>
      <div className="dialog-body">{children}</div>
      {actions && <div className="dialog-actions">{actions}</div>}
    </div>
  </div>
}

export function Stars({ value, onChange, label = 'Rating' }: { value: number; onChange?: (value: number) => void; label?: string }) {
  if (!onChange) return <span className="stars" role="img" aria-label={`${value} out of 5 stars`}>{[1, 2, 3, 4, 5].map((n) => <span key={n} className={n <= Math.round(value) ? 'star-on' : 'star-off'} aria-hidden="true">★</span>)}</span>
  return <div className="stars stars-input" role="radiogroup" aria-label={label}>
    {[1, 2, 3, 4, 5].map((n) => <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className={n <= value ? 'star-on' : 'star-off'} onClick={() => onChange(n)}>★</button>)}
  </div>
}

export function RatingText({ rating, count }: { rating: number; count: number }) {
  return count > 0 ? <span className="rating-text">★ {rating.toFixed(1)} <small>({count})</small></span> : <span className="rating-text rating-new">New</span>
}

export function FoodArt({ item, className = '' }: { item: Pick<Food, 'emoji' | 'tone' | 'imageUrl' | 'name'> | Pick<CartLine, 'emoji' | 'tone' | 'imageUrl' | 'name'>; className?: string }) {
  return <span className={`food-art tone-${item.tone} ${className}`}>
    {item.imageUrl ? <img src={item.imageUrl} alt={item.name} loading="lazy" onError={(e) => { e.currentTarget.style.display = 'none' }} /> : null}
    <span className="food-art-emoji" aria-hidden="true">{item.emoji}</span>
  </span>
}

export function LineChart({ data, valueKey, label, format = (v: number) => String(v), tone = 'orange' }: { data: { date: string; orders: number; revenue: number }[]; valueKey: 'orders' | 'revenue'; label: string; format?: (value: number) => string; tone?: 'orange' | 'ink' }) {
  const W = 640, H = 200, PAD = { l: 44, r: 12, t: 14, b: 26 }
  if (!data.length) return <p className="muted">No data yet.</p>
  const values = data.map((d) => Number(d[valueKey]) || 0)
  const max = Math.max(...values, 1)
  const x = (i: number) => PAD.l + (data.length === 1 ? (W - PAD.l - PAD.r) / 2 : (i / (data.length - 1)) * (W - PAD.l - PAD.r))
  const y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b)
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = `${line} L${x(values.length - 1).toFixed(1)},${H - PAD.b} L${x(0).toFixed(1)},${H - PAD.b} Z`
  const ticks = [0, 0.5, 1].map((t) => max * t)
  const every = Math.max(1, Math.ceil(data.length / 7))
  return <figure className={`chart chart-${tone}`}>
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${label}: ${data.map((d) => `${d.date} ${format(Number(d[valueKey]))}`).join(', ')}`}>
      {ticks.map((t) => <g key={t}><line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="chart-grid" /><text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" className="chart-axis">{format(Math.round(t))}</text></g>)}
      <path d={area} className="chart-area" /><path d={line} className="chart-line" />
      {values.map((v, i) => <g key={data[i].date}><circle cx={x(i)} cy={y(v)} r={3.5} className="chart-dot"><title>{`${data[i].date}: ${format(v)}`}</title></circle>{i % every === 0 && <text x={x(i)} y={H - 8} textAnchor="middle" className="chart-axis">{data[i].date.slice(5)}</text>}</g>)}
    </svg>
  </figure>
}

export const Money = ({ value }: { value: number }) => <>{formatMoney(value)}</>

export function ConfirmDialog({ title, body, confirmLabel, danger, busy, onConfirm, onClose, children }: { title: string; body?: ReactNode; confirmLabel: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void; children?: ReactNode }) {
  return <Dialog title={title} onClose={onClose} actions={<><button type="button" className="button button-light" onClick={onClose}>Cancel</button>
    <button type="button" className={`button ${danger ? 'button-danger' : 'button-primary'}`} disabled={busy} onClick={onConfirm}>{busy ? 'Working…' : confirmLabel}</button></>}>{body && <p>{body}</p>}{children}</Dialog>
}
