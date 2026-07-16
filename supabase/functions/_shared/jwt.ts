const SECRET = Deno.env.get('JWT_SECRET') ?? 'susu-jwt-secret-change-in-production'
// Seven days was generous for a money product. Two is plenty, and the token
// now carries a version so it can be killed before then.
const EXPIRY = 60 * 60 * 24 * 2

function base64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function decode64url(str: string): string {
  return atob(str.replace(/-/g, '+').replace(/_/g, '/'))
}

async function getKey(usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usage
  )
}

export async function signJWT(payload: Record<string, unknown>): Promise<string> {
  const header  = base64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const body    = base64url(new TextEncoder().encode(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + EXPIRY,
  })))
  const msg     = `${header}.${body}`
  const key     = await getKey(['sign'])
  const sig     = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))
  return `${msg}.${base64url(sig)}`
}

export async function verifyJWT(token: string): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [header, body, sig] = parts
    const key      = await getKey(['verify'])
    const sigBytes = Uint8Array.from(decode64url(sig), (c) => c.charCodeAt(0))
    const valid    = await crypto.subtle.verify(
      'HMAC', key, sigBytes, new TextEncoder().encode(`${header}.${body}`)
    )
    if (!valid) return null

    const payload = JSON.parse(decode64url(body))
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Built on first use, not at import.
 *
 * auth-admin-login imports signJWT from this module. A client constructed at
 * module scope runs the moment the file loads — so a missing env var would
 * throw before the function could boot, and a function that fails to boot
 * returns no CORS headers, which the browser reports as "Failed to fetch" with
 * nothing in it to diagnose. Sign-in must not depend on machinery it never uses.
 */
let _db: SupabaseClient | null = null
function db(): SupabaseClient {
  if (!_db) {
    _db = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
  }
  return _db
}

/**
 * A signed JWT alone is not enough. Until now a stolen token stayed valid for
 * its full seven days — suspending a member did nothing to their live session.
 * Every request now checks the token's version against the database, so
 * suspending, removing or revoking cuts access immediately.
 */
async function stillValid(payload: Record<string, unknown>, kind: 'admin' | 'member'): Promise<boolean> {
  const { data, error } = await db().rpc('session_is_current', {
    p_id:      payload.sub as string,
    p_kind:    kind,
    p_version: (payload.tv as number) ?? 0,
  })
  if (error) {
    // Fail closed. An unavailable check must not become an open door.
    console.error('session check failed:', error.message)
    return false
  }
  return data === true
}

export async function requireAdmin(req: Request): Promise<Record<string, unknown> | null> {
  const auth = req.headers.get('authorization') ?? req.headers.get('x-admin-token')
  if (!auth) return null
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth
  const payload = await verifyJWT(token)
  if (!payload || payload.type !== 'admin') return null
  if (!(await stillValid(payload, 'admin'))) return null
  return payload
}

export async function requireMember(req: Request): Promise<Record<string, unknown> | null> {
  const auth = req.headers.get('authorization') ?? req.headers.get('x-member-token')
  if (!auth) return null
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth
  const payload = await verifyJWT(token)
  if (!payload || payload.type !== 'member') return null
  if (!(await stillValid(payload, 'member'))) return null
  return payload
}
