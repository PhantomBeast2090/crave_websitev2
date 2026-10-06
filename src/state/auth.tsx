import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import type { Profile } from '../types'
import { createOwnProfile, loadProfile } from '../lib/api/auth'
import { friendlyError, logError } from '../lib/errors'
import { supabase } from '../lib/supabase'

export type Door = 'student' | 'vendor' | 'management'
export type BlockReason = 'missing' | 'inactive' | 'unsupported-role' | 'error'
export type AuthState =
  | { status: 'loading' }
  | { status: 'signed-out'; notice?: string }
  | { status: 'ready'; session: Session; profile: Profile }
  | { status: 'blocked'; session: Session; reason: BlockReason; message?: string }

type AuthApi = {
  state: AuthState
  signIn: (email: string, password: string, door: Door) => Promise<{ ok: boolean; message?: string }>
  signUp: (input: { email: string; password: string; name: string; door: Door }) => Promise<{ ok: boolean; message?: string }>
  signOut: () => Promise<void>
}
const AuthContext = createContext<AuthApi | null>(null)

const doorRole = { student: 'STUDENT', vendor: 'VENDOR', management: 'ADMIN' } as const
const doorLabel = { STUDENT: 'Student', VENDOR: 'Vendor', ADMIN: 'Management', PENDING_VENDOR: 'Vendor (pending approval)' } as const

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: supabase ? 'loading' : 'signed-out' })
  const hydrationSeq = useRef(0)
  const inFlight = useRef<string | null>(null)

  /** Resolves identity strictly from profiles.id = auth user id; never falls back to another role. */
  const hydrate = useCallback(async (session: Session, door?: Door): Promise<{ ok: boolean; message?: string }> => {
    const seq = ++hydrationSeq.current
    inFlight.current = session.user.id
    try {
      let result = await loadProfile(session.user.id)
      // Explicit sign-in through the Student / Vendor door may create the caller's OWN profile (RLS-limited).
      if (!result.ok && result.reason === 'missing' && door && door !== 'management') {
        await createOwnProfile(session.user, door === 'vendor' ? 'PENDING_VENDOR' : 'STUDENT')
        result = await loadProfile(session.user.id)
      }
      if (seq !== hydrationSeq.current) return { ok: false }
      if (!result.ok) {
        setState({ status: 'blocked', session, reason: result.reason, message: result.message })
        return { ok: false, message: result.reason === 'missing' ? 'No Crave profile exists for this account.' : 'We could not verify this account.' }
      }
      const { profile } = result
      if (!profile.isActive) { setState({ status: 'blocked', session, reason: 'inactive' }); return { ok: false, message: 'This account has been disabled.' } }
      if (door && profile.role !== 'PENDING_VENDOR' && profile.role !== doorRole[door]) {
        await supabase!.auth.signOut()
        const msg = `This account has ${doorLabel[profile.role]} access. Choose that door to continue.`
        setState({ status: 'signed-out', notice: msg })
        return { ok: false, message: msg }
      }
      setState({ status: 'ready', session, profile })
      return { ok: true }
    } catch (error) {
      logError('auth:hydrate', error)
      if (seq === hydrationSeq.current) setState({ status: 'blocked', session, reason: 'error' })
      return { ok: false, message: friendlyError(error, 'We could not verify this account.') }
    } finally {
      if (seq === hydrationSeq.current) inFlight.current = null
    }
  }, [])

  useEffect(() => {
    if (!supabase) return
    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      if (data.session) void hydrate(data.session); else setState({ status: 'signed-out' })
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // Never await Supabase calls inside this callback (supabase-js deadlocks); defer instead.
      window.setTimeout(() => {
        if (!active) return
        if (!session || event === 'SIGNED_OUT') { hydrationSeq.current++; setState({ status: 'signed-out' }); return }
        if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          setState((current) => current.status === 'ready' && current.session.user.id === session.user.id ? { ...current, session } : current)
          return
        }
        if (inFlight.current === session.user.id) return
        setState((current) => current.status === 'ready' && current.session.user.id === session.user.id ? current : { status: 'loading' })
        void hydrate(session)
      }, 0)
    })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [hydrate])

  const signIn: AuthApi['signIn'] = useCallback(async (email, password, door) => {
    if (!supabase) return { ok: false, message: 'Crave is not configured for this environment.' }
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) {
      logError('auth:signIn', error)
      if (/email not confirmed/i.test(error.message)) return { ok: false, message: 'Please confirm your email first — check your inbox.' }
      return { ok: false, message: 'Incorrect email or password.' }
    }
    return hydrate(data.session, door)
  }, [hydrate])

  const signUp: AuthApi['signUp'] = useCallback(async ({ email, password, name, door }) => {
    if (!supabase) return { ok: false, message: 'Crave is not configured for this environment.' }
    if (door === 'management') return { ok: false, message: 'Management accounts are provisioned by Crave admins.' }
    const { data, error } = await supabase.auth.signUp({ email: email.trim(), password, options: { data: { name: name.trim() } } })
    if (error) { logError('auth:signUp', error); return { ok: false, message: /already registered/i.test(error.message) ? 'That email already has an account. Try signing in.' : friendlyError(error.message, 'Could not create the account.') } }
    if (!data.session) return { ok: true, message: 'Check your email to confirm your account, then sign in here.' }
    return hydrate(data.session, door)
  }, [hydrate])

  const signOut = useCallback(async () => {
    hydrationSeq.current++
    await supabase?.auth.signOut()
    setState({ status: 'signed-out' })
  }, [])

  return <AuthContext.Provider value={{ state, signIn, signUp, signOut }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

/** For screens that only render when signed in. */
export function useReadyAuth() {
  const { state, signOut } = useAuth()
  if (state.status !== 'ready') throw new Error('useReadyAuth used outside an authenticated screen')
  return { session: state.session, profile: state.profile, signOut }
}
