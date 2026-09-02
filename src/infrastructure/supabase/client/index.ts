import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * The ONLY place a Supabase client is constructed.
 *
 * Built on first use, never at module scope. A client constructed at import
 * time runs the moment the file loads, so a missing environment variable
 * throws before anything can handle it — and a serverless function that fails
 * to boot returns no useful error at all. The same lesson is recorded in
 * supabase/functions/_shared/jwt.ts, which learned it the hard way.
 */
let _admin: SupabaseClient | null = null

export function adminClient(): SupabaseClient {
  if (_admin) return _admin

  /*
   * This client holds `service_role`, which bypasses row-level security
   * entirely. It must never be constructed in a browser.
   *
   * Today it cannot be: nothing presentational imports this module, and Next
   * only inlines `NEXT_PUBLIC_*` variables, so `SUPABASE_SERVICE_ROLE_KEY`
   * resolves to undefined in a bundle. Both of those are properties of the
   * current import graph rather than of this file, and an import graph is one
   * careless `import` away from changing.
   *
   * So the file states the rule itself. A client build that ever reaches this
   * line fails loudly here, rather than shipping a key that grants unrestricted
   * read and write on every member's money.
   */
  if (typeof window !== 'undefined') {
    throw new Error(
      'adminClient() was called in a browser. This client carries service_role, ' +
      'which bypasses row-level security — it belongs on the server only.')
  }

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url) throw new Error('SUPABASE_URL is not set')
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set — refusing to start without it')
  _admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
  return _admin
}

/** Test seam: inject a fake so repositories can be exercised without a network. */
export function __setClientForTests(c: SupabaseClient | null) { _admin = c }
