import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2'

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map((s) => s.trim()).filter(Boolean)

/** Bearer-token API: no cookies, so a permissive default is safe, but ALLOWED_ORIGINS tightens it. */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const allow = allowedOrigins.length === 0 ? '*' : allowedOrigins.includes(origin) ? origin : allowedOrigins[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), 'Content-Type': 'application/json' } })
}

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', { auth: { persistSession: false } })
}

/** Resolves the caller from the JWT. Identity always comes from Supabase Auth, never from the body. */
export async function requireUser(req: Request): Promise<User> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'Please sign in again.')
  const anon = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { auth: { persistSession: false } })
  const { data, error } = await anon.auth.getUser(token)
  if (error || !data.user) throw new HttpError(401, 'Please sign in again.')
  return data.user
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>
  } catch { /* fall through */ }
  throw new HttpError(400, 'Invalid request.')
}

/** Maps DB / gateway failures to safe user-facing messages; details stay in the function logs. */
export function toResponse(req: Request, err: unknown, context: string): Response {
  if (err instanceof HttpError) return json(req, { error: err.message }, err.status)
  const message = String((err as { message?: string })?.message ?? err)
  console.error(`[${context}]`, message)
  const friendly: [RegExp, number, string][] = [
    [/already been paid/i, 409, 'This order has already been paid.'],
    [/no longer be paid|expired/i, 409, 'This order has expired. Please place it again.'],
    [/Order not found/i, 404, 'Order not found.'],
    [/not an online-payment/i, 400, 'This order is not an online-payment order.'],
    [/amount mismatch/i, 400, 'Payment amount did not match this order.'],
  ]
  for (const [re, status, text] of friendly) if (re.test(message)) return json(req, { error: text }, status)
  return json(req, { error: 'Something went wrong. Please try again.' }, 500)
}
