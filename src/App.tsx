import { Component, lazy, Suspense, type ReactNode } from 'react'
import { logError } from './lib/errors'
import { BlockedScreen, PendingVendorScreen } from './screens/shared/Blocked'
import { LoginPage } from './screens/shared/Login'
import { AuthProvider, useAuth } from './state/auth'
import { RouterProvider } from './state/router'
import { ToastProvider } from './state/toast'
import { Spinner } from './ui/kit'

// Each workspace is its own chunk: a student never downloads the vendor or management code.
const StudentApp = lazy(() => import('./screens/student/StudentApp').then((m) => ({ default: m.StudentApp })))
const VendorApp = lazy(() => import('./screens/vendor/VendorApp').then((m) => ({ default: m.VendorApp })))
const AdminApp = lazy(() => import('./screens/admin/AdminApp').then((m) => ({ default: m.AdminApp })))

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: unknown) { logError('render', error) }
  render() {
    return this.state.failed
      ? <div className="login-screen"><div className="login-panel" role="alert"><h1 style={{ fontSize: 30 }}>Something broke on our side</h1><p>Nothing was lost. Reload the page to carry on.</p><button type="button" className="button button-dark" onClick={() => window.location.reload()}>Reload</button></div></div>
      : this.props.children
  }
}

/** Identity -> role -> workspace. The role only ever comes from the signed-in user's profiles row. */
function Root() {
  const { state } = useAuth()
  if (state.status === 'loading') return <div className="login-screen"><Spinner label="Checking your account" /></div>
  if (state.status === 'signed-out') return <LoginPage />
  if (state.status === 'blocked') return <BlockedScreen reason={state.reason} />
  const { profile } = state
  const workspace = (() => { switch (profile.role) {
    case 'STUDENT': return <StudentApp key={profile.id} profile={profile} />
    case 'VENDOR': return <VendorApp key={profile.id} profile={profile} />
    case 'ADMIN': return <AdminApp key={profile.id} profile={profile} />
    case 'PENDING_VENDOR': return <PendingVendorScreen name={profile.name} />
  } })()
  return <Suspense fallback={<div className="login-screen"><Spinner label="Loading" /></div>}>{workspace}</Suspense>
}

export default function App() {
  return <ErrorBoundary><RouterProvider><ToastProvider><AuthProvider><Root /></AuthProvider></ToastProvider></RouterProvider></ErrorBoundary>
}
