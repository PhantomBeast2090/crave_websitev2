import { formatMoney, lineTotal, MAX_LINE_QUANTITY } from '../../lib/pricing'
import { useCart } from '../../state/cart'
import { Link, useRouter } from '../../state/router'
import { EmptyState, FoodArt, Page, PageHeading } from '../../ui/kit'

export function CartPage() {
  const cart = useCart()
  const { navigate } = useRouter()
  if (!cart.lines.length) return <Page><PageHeading eyebrow="YOUR BAG" title={<>Good choices<br /><em>live here.</em></>} /><EmptyState title="Your bag is feeling shy" copy="Find something crispy, saucy, or suspiciously sweet." action="Go find a craving" onAction={() => navigate('/explore')} /></Page>
  return <Page className="page-cart">
    <PageHeading eyebrow="YOUR BAG" title={<>Good choices<br /><em>live here.</em></>}><span className="bag-count">{cart.count} item{cart.count === 1 ? '' : 's'} · {cart.lines[0].outletName}</span></PageHeading>
    <div className="two-col">
      <div>
        {cart.lines.map((line) => <div className="cart-line" key={line.key}>
          <FoodArt item={line} />
          <div><h3>{line.name}</h3><p>{[...line.options.map((o) => o.name), line.note].filter(Boolean).join(' · ') || 'No customisations'}</p><p>{formatMoney(line.price + line.options.reduce((s, o) => s + o.extraPrice, 0))} each</p></div>
          <div className="row"><div className="qty" role="group" aria-label={`Quantity of ${line.name}`}>
            <button type="button" aria-label={`Decrease ${line.name}`} onClick={() => cart.setQuantity(line.key, line.quantity - 1)}>−</button><span aria-live="polite">{line.quantity}</span>
            <button type="button" aria-label={`Increase ${line.name}`} disabled={line.quantity >= MAX_LINE_QUANTITY} onClick={() => cart.setQuantity(line.key, line.quantity + 1)}>+</button></div>
            <strong>{formatMoney(lineTotal(line))}</strong>
            <button type="button" className="button button-quiet small-button" onClick={() => cart.setQuantity(line.key, 0)} aria-label={`Remove ${line.name}`}>Remove</button></div>
        </div>)}
        <p style={{ marginTop: 16 }}><Link to={`/outlet/${cart.lines[0].outletId}`} className="text-button">+ add something else from {cart.lines[0].outletName}</Link></p>
      </div>
      <aside className="summary-card" aria-label="Order summary">
        <span className="eyebrow">ESTIMATED TOTAL</span>
        <div className="summary-line"><span>Items</span><strong>{formatMoney(cart.totals.subtotal)}</strong></div>
        <div className="summary-line"><span>Tax (5%)</span><strong>{formatMoney(cart.totals.tax)}</strong></div>
        <div className="summary-line summary-total"><span>Total</span><strong>{formatMoney(cart.totals.total)}</strong></div>
        <button type="button" className="button button-primary full-button" onClick={() => navigate('/checkout')}>Choose pickup slot <span aria-hidden="true">↗</span></button>
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>Prices, stock and tax are confirmed by Crave at checkout — the amount you pay is always the server's.</p>
      </aside>
    </div>
  </Page>
}
