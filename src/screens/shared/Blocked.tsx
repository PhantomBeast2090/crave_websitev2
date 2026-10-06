import { BrandMark } from '../../shell/Shell'
import { useAuth, type BlockReason } from '../../state/auth'

const copy: Record<BlockReason, { title: string; body: string }> = {
  missing: { title: "We can't find your Crave profile", body: "You're signed in, but there's no Crave profile attached to this account, so we can't tell what you're allowed to see. Please contact Crave support, or sign out and use the correct account." },
  inactive: { title: 'This account is disabled', body: 'Your Crave account has been deactivated. Contact campus management if you think this is a mistake.' },
  'unsupported-role': { title: "We don't recognise this account type", body: 'Your profile has a role this website does not support. Please contact Crave support.' },
  error: { title: "We couldn't verify your account", body: "Something went wrong while checking who you are. Nothing was shown or changed. Please try again in a moment." },
}

export function BlockedScreen({ reason }: { reason: BlockReason }) {
  const { signOut } = useAuth()
  const { title, body } = copy[reason]
  return <div className="login-screen"><div className="login-topline"><BrandMark /></div>
    <main className="login-shell" style={{ gridTemplateColumns: '1fr' }}>
      <div className="login-panel" role="alert"><span className="eyebrow orange-ink">ACCOUNT CHECK</span><h1 style={{ fontSize: 34, margin: '8px 0' }}>{title}</h1><p>{body}</p>
        <div className="row"><button type="button" className="button button-dark" onClick={() => void signOut()}>Sign out</button>{reason === 'error' && <button type="button" className="button button-light" onClick={() => window.location.reload()}>Try again</button>}</div>
      </div>
    </main></div>
}

export function PendingVendorScreen({ name }: { name: string }) {
  const { signOut } = useAuth()
  return <div className="login-screen"><div className="login-topline"><BrandMark /></div>
    <main className="login-shell" style={{ gridTemplateColumns: '1fr' }}>
      <div className="login-panel"><span className="eyebrow orange-ink">VENDOR APPLICATION</span><h1 style={{ fontSize: 34, margin: '8px 0' }}>Thanks, {name.split(' ')[0]} — you're on the list.</h1>
        <p>Campus management is reviewing your vendor application. You'll get access to the vendor workspace as soon as it's approved. Until then there's nothing to see here.</p>
        <button type="button" className="button button-dark" onClick={() => void signOut()}>Sign out</button></div>
    </main></div>
}
