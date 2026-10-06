import { useAuth } from '../../state/auth'
import { Link } from '../../state/router'
import { Page } from '../../ui/kit'

const home = { STUDENT: '/', VENDOR: '/vendor', ADMIN: '/admin', PENDING_VENDOR: '/' } as const

export function NotFound() {
  const { state } = useAuth()
  const to = state.status === 'ready' ? home[state.profile.role] : '/'
  return <Page><div className="empty-state"><div className="empty-shape" aria-hidden="true">?</div><h2>That page took a snack break</h2><p>We couldn't find what you were looking for.</p><Link to={to} className="button button-primary">Back to my workspace <span aria-hidden="true">↗</span></Link></div></Page>
}

/** Shown when a signed-in user opens a URL that belongs to another role's workspace. */
export function WrongArea() {
  const { state } = useAuth()
  const to = state.status === 'ready' ? home[state.profile.role] : '/'
  return <Page><div className="empty-state" role="alert"><div className="empty-shape" aria-hidden="true">◎</div><span className="eyebrow orange-ink">PRIVATE CRAVE WORKSPACE</span><h2>This area isn't for your account</h2>
    <p>Your Crave profile doesn't have access to this workspace. Access is decided by your account's role on our servers, not by the address you type.</p><Link to={to} className="button button-primary">Back to my workspace <span aria-hidden="true">↗</span></Link></div></Page>
}
