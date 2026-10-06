import type { Profile, Role } from '../../types'
import { supabase } from '../supabase'

const ROLES: Role[] = ['STUDENT', 'VENDOR', 'ADMIN', 'PENDING_VENDOR']

export type ProfileResult =
  | { ok: true; profile: Profile }
  | { ok: false; reason: 'missing' | 'unsupported-role' | 'error'; message?: string }

/**
 * The ONLY source of identity: the profiles row whose primary key equals the authenticated user's id.
 * No fallback role, no "first row", no cached profile: a missing row is an explicit error state.
 */
export async function loadProfile(userId: string): Promise<ProfileResult> {
  if (!supabase) return { ok: false, reason: 'error', message: 'Crave is not configured for this environment.' }
  const { data, error } = await supabase.from('profiles').select('id,name,email,role,is_active,phone').eq('id', userId).maybeSingle()
  if (error) return { ok: false, reason: 'error', message: error.message }
  if (!data) return { ok: false, reason: 'missing' }
  if (data.id !== userId) return { ok: false, reason: 'error', message: 'Profile mismatch.' }
  const role = String(data.role).toUpperCase() as Role
  if (!ROLES.includes(role)) return { ok: false, reason: 'unsupported-role' }
  return { ok: true, profile: { id: data.id, name: data.name, email: data.email, role, isActive: Boolean(data.is_active), phone: data.phone } }
}

/** Self-registration only. RLS allows nothing but STUDENT or PENDING_VENDOR here; admins approve vendors. */
export async function createOwnProfile(user: { id: string; email?: string | null; user_metadata?: Record<string, unknown> }, role: 'STUDENT' | 'PENDING_VENDOR'): Promise<void> {
  if (!supabase) throw new Error('Crave is not configured for this environment.')
  const meta = user.user_metadata ?? {}
  const email = user.email ?? ''
  const { error } = await supabase.from('profiles').insert({
    id: user.id, email, name: String(meta.name || email.split('@')[0] || 'Crave user').slice(0, 80), role,
    phone: meta.phone ? String(meta.phone).slice(0, 20) : null,
  })
  if (error && error.code !== '23505') throw error
}
