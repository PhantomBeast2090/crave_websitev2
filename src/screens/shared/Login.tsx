import { useState, type FormEvent } from 'react'
import { BrandMark } from '../../shell/Shell'
import { isSupabaseConfigured } from '../../lib/supabase'
import { useAuth, type Door } from '../../state/auth'
import { useRouter } from '../../state/router'

const doorHome: Record<Door, string> = { student: '/', vendor: '/vendor', management: '/admin' }

const doors: { id: Door; label: string; copy: string; icon: string }[] = [
  { id: 'student', label: 'Student', copy: 'Find bites, save favourites, and skip campus queues.', icon: '✦' },
  { id: 'vendor', label: 'Vendor', copy: 'Run your outlet, menu, stock, and order board.', icon: '▦' },
  { id: 'management', label: 'Management', copy: 'See campus-wide outlets, users, payments, and operations.', icon: '◎' },
]

export function LoginPage() {
  const { state, signIn, signUp } = useAuth()
  const { navigate } = useRouter()
  const [door, setDoor] = useState<Door>('student')
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const canRegister = door !== 'management'
  const notice = message || (state.status === 'signed-out' ? state.notice : '') || ''

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    setMessage('')
    if (mode === 'sign-up') {
      if (name.trim().length < 2) return setMessage('Please enter your name.')
      if (password.length < 8) return setMessage('Use a password with at least 8 characters.')
    }
    setBusy(true)
    const result = mode === 'sign-in' ? await signIn(email, password, door) : await signUp({ email, password, name, door })
    setBusy(false)
    if (result.message) setMessage(result.message)
    if (!result.ok) setPassword('')
    else if (mode === 'sign-in') navigate(doorHome[door], { replace: true })   // never land on another role's URL
  }

  const heading = mode === 'sign-in' ? `Sign in as ${door === 'management' ? 'management' : door}` : door === 'vendor' ? 'Apply as a vendor' : 'Create your Student ID'
  return <div className="login-screen">
    <div className="login-topline"><BrandMark /></div>
    <div className="login-shell">
      <div className="login-copy">
        <span className="eyebrow orange-ink">SRMIST CAMPUS FOOD</span>
        <h1>Who are you<br /><em>at Crave?</em></h1>
        <p>Sign in once. Your approved profile decides which world you can enter.</p>
        <div className="login-lockup"><span>ROLE-GATED ACCESS</span><strong>Your role comes from Crave's records, never from this page.</strong></div>
      </div>
      <form className="login-panel" onSubmit={submit} noValidate>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="eyebrow">CHOOSE YOUR DOOR</legend>
          <div className="login-role-grid" role="radiogroup" aria-label="Account type">
            {doors.map((option) => <button key={option.id} type="button" role="radio" aria-checked={door === option.id} className={`login-role-option ${door === option.id ? 'login-role-selected' : ''}`}
              onClick={() => { setDoor(option.id); setMessage(''); if (option.id === 'management') setMode('sign-in') }}>
              <span className="login-role-icon" aria-hidden="true">{option.icon}</span><span><strong>{option.label}</strong><small>{option.copy}</small></span><i aria-hidden="true">{door === option.id ? '✓' : '↗'}</i>
            </button>)}
          </div>
        </fieldset>
        <div className="login-form-heading"><div><span className="eyebrow">{mode === 'sign-in' ? 'WELCOME BACK' : 'NEW ACCOUNT'}</span><h2>{heading}.</h2></div></div>
        <div className="auth-form">
          {mode === 'sign-up' && <div className="field"><label htmlFor="login-name">Your name</label><input id="login-name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required /></div>}
          <div className="field"><label htmlFor="login-email">College email</label><input id="login-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
          <div className="field"><label htmlFor="login-password">Password</label><input id="login-password" type="password" autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} required /></div>
          <button type="submit" className="button button-primary full-button" disabled={busy || !email || !password || !isSupabaseConfigured}>{busy ? 'Verifying…' : mode === 'sign-in' ? 'Sign in' : door === 'vendor' ? 'Send application' : 'Create student ID'} <span aria-hidden="true">↗</span></button>
          <div role="alert" aria-live="assertive">{notice && <small className="auth-message">{notice}</small>}</div>
          {!isSupabaseConfigured && <small className="auth-message">Crave isn't configured for this environment yet (missing Supabase settings).</small>}
          {canRegister && <button type="button" className="text-button" onClick={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setMessage('') }}>{mode === 'sign-in' ? (door === 'vendor' ? 'Want to sell on Crave? Apply as a vendor' : 'Need a Student ID? Create one') : 'Already have an account? Sign in'}</button>}
        </div>
      </form>
    </div>
    <p className="login-footnote">Selecting a different door never grants access — your role is read from your protected profile.</p>
  </div>
}
