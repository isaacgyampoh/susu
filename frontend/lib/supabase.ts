import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON)

// Edge Function base URL
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
  const { method = 'GET', body, token } = options
  const isFormData = body instanceof FormData

  const headers: Record<string, string> = {
    apikey: SUPABASE_ANON,
  }
  if (token)       headers['Authorization'] = `Bearer ${token}`
  if (!isFormData) headers['Content-Type']  = 'application/json'

  try {
    const res = await fetch(`${FN_BASE}/${fn}`, {
      method,
      headers,
      body: isFormData ? body : body ? JSON.stringify(body) : undefined,
    })
    const json = await res.json()
    if (!res.ok) return { data: null, error: json.error ?? 'Something went wrong' }
    return { data: json as T, error: null }
  } catch (e) {
    return { data: null, error: (e as Error).message }
  }
}

// Auth helpers
export const getAdminToken  = () => typeof window !== 'undefined' ? localStorage.getItem('admin_token')  : null
export const getMemberToken = () => typeof window !== 'undefined' ? localStorage.getItem('member_token') : null

export const setAdminToken  = (t: string) => localStorage.setItem('admin_token', t)
export const setMemberToken = (t: string) => localStorage.setItem('member_token', t)

export const clearAdminAuth  = () => { localStorage.removeItem('admin_token');  localStorage.removeItem('admin_user') }
export const clearMemberAuth = () => { localStorage.removeItem('member_token'); localStorage.removeItem('member_user') }
