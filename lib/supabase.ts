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

    if (!res.ok) return { data: null, error: json?.error ?? `Request failed (${res.status})` }
    return { data: json as T, error: null }
  } catch (e) {
    return { data: null, error: (e as Error).message || 'Network error' }
  }
}

// ── Auth token helpers ──
export const getAdminToken  = () => typeof window !== 'undefined' ? localStorage.getItem('admin_token')  : null
export const getMemberToken = () => typeof window !== 'undefined' ? localStorage.getItem('member_token') : null

export const setAdminToken = (t: string) => {
  localStorage.setItem('admin_token', t)
  document.cookie = `admin_token=${t}; path=/; max-age=604800; SameSite=Lax`
}
export const setMemberToken = (t: string) => {
  localStorage.setItem('member_token', t)
  document.cookie = `member_token=${t}; path=/; max-age=604800; SameSite=Lax`
}

export const clearAdminAuth = () => {
  localStorage.removeItem('admin_token')
  localStorage.removeItem('admin_user')
  document.cookie = 'admin_token=; path=/; max-age=0'
}
export const clearMemberAuth = () => {
  localStorage.removeItem('member_token')
  localStorage.removeItem('member_user')
  document.cookie = 'member_token=; path=/; max-age=0'
}
