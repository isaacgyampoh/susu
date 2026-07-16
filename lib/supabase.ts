// Supabase Edge Function client
// Note: we do NOT create a supabase-js client here — all data access goes
// through Edge Functions via callFunction(). This avoids build-time crashes
// when env vars aren't present and keeps auth logic in one place.

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL  ?? ''
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

const FN_BASE = `${SUPABASE_URL}/functions/v1`

type FetchOptions = {
  method?: string
  body?:   unknown | FormData
  token?:  string
}

export async function callFunction<T = unknown>(
  fn: string,
  options: FetchOptions = {}
): Promise<{ data: T | null; error: string | null }> {
  if (!SUPABASE_URL || !SUPABASE_ANON) {
    return { data: null, error: 'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in your environment variables.' }
  }

  const { method = 'GET', body, token } = options
  const isFormData = body instanceof FormData

  const headers: Record<string, string> = { apikey: SUPABASE_ANON }
  if (token)       headers['Authorization'] = `Bearer ${token}`
  if (!isFormData) headers['Content-Type']  = 'application/json'

  try {
    const res = await fetch(`${FN_BASE}/${fn}`, {
      method,
      headers,
      body: isFormData ? (body as FormData) : body ? JSON.stringify(body) : undefined,
    })

    const text = await res.text()
    let json: any
    try { json = text ? JSON.parse(text) : {} }
    catch { return { data: null, error: `Invalid response from server (${res.status})` } }

    if (res.status === 401 && typeof window !== 'undefined') {
      // Revoked or expired — don't sit on a dead session
      const kind = fn.includes('member') || fn.startsWith('payments') || fn.startsWith('contact') ? 'member' : 'admin'
      handleUnauthorized(kind as 'admin' | 'member')
    }
    if (!res.ok) return { data: null, error: json?.error ?? `Request failed (${res.status})` }
    return { data: json as T, error: null }
  } catch (e) {
    return { data: null, error: (e as Error).message || 'Network error' }
  }
}

// ── Auth token helpers ──
export const getAdminToken  = () => typeof window !== 'undefined' ? localStorage.getItem('admin_token')  : null
export const getMemberToken = () => typeof window !== 'undefined' ? localStorage.getItem('member_token') : null

/*
 * The cookie exists only so middleware can route; the Authorization header is
 * the real credential. It cannot be httpOnly because it is written here in the
 * browser — that would need a server route to set it, and is the next thing
 * worth doing. Until then: Secure, SameSite=Strict, and a CSP that makes it
 * hard for foreign script to run at all.
 *
 * Two days, matching the JWT. A cookie outliving its token is just litter.
 */
const COOKIE_MAX_AGE = 60 * 60 * 24 * 2

function setCookie(name: string, value: string) {
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${name}=${value}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Strict${secure}`
}

export const setAdminToken = (t: string) => {
  localStorage.setItem('admin_token', t)
  setCookie('admin_token', t)
}
export const setMemberToken = (t: string) => {
  localStorage.setItem('member_token', t)
  setCookie('member_token', t)
}

export const clearAdminAuth = () => {
  localStorage.removeItem('admin_token')
  localStorage.removeItem('admin_user')
  document.cookie = 'admin_token=; path=/; max-age=0; SameSite=Strict'
}
export const clearMemberAuth = () => {
  localStorage.removeItem('member_token')
  localStorage.removeItem('member_user')
  document.cookie = 'member_token=; path=/; max-age=0; SameSite=Strict'
}

/**
 * A 401 means the session is gone — expired, or revoked because the member was
 * suspended. Clear it and send them to sign in rather than leaving a dead token
 * in place looking valid.
 */
export function handleUnauthorized(kind: 'admin' | 'member') {
  if (kind === 'admin') { clearAdminAuth(); location.href = '/' }
  else                  { clearMemberAuth(); location.href = '/m/login' }
}
