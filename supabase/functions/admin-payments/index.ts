import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'

/**
 * THE PAYMENTS WORKSPACE.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Two reads, both answered by the database in one round trip:
 *
 *   GET ?…filters…   the list, its count, and the totals for that same filter
 *   GET ?id=<uuid>   one payment in full, with its allocations and timeline
 *
 * This function holds no query logic of its own. That is deliberate: the
 * endpoint it replaces paginated first and then filtered the page in
 * JavaScript, so "manual payments, page 1" returned however many of the newest
 * fifty happened to be manual, under a pager computed from the unfiltered
 * count. Filtering after paging cannot be made correct anywhere but in the
 * query that chooses the rows.
 *
 * ── AUTHORIZATION ───────────────────────────────────────────────────────
 *
 * `requireAdmin` runs before anything is read, and the RPCs are
 * service_role-only, so there is no route to this data that skips it. Nothing
 * the browser sends is treated as authorization: the id in `?id=` selects a
 * record, it does not grant access to one, and the caller's own identity comes
 * from the verified token rather than from any parameter.
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'GET') return error('Method not allowed', 405, req)

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401, req)

  try {
    const u  = new URL(req.url)
    const id = u.searchParams.get('id')

    if (id) {
      if (!/^[0-9a-f-]{36}$/i.test(id)) return error('Unknown payment', 404, req)
      const { data, error: e } = await supabaseAdmin.rpc('get_payment_detail', { p_id: id })
      if (e) {
        console.error('get_payment_detail:', e.message)
        return error('We could not load this payment. Please try again.', 502, req)
      }
      if (!data) return error('Unknown payment', 404, req)
      return json(data, 200, req)
    }

    const num = (k: string) => {
      const v = u.searchParams.get(k)
      if (v === null || v.trim() === '') return null
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    const day = (k: string) => {
      const v = u.searchParams.get(k)
      return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
    }
    const oneOf = (k: string, allowed: string[], fallback: string) => {
      const v = u.searchParams.get(k) ?? fallback
      return allowed.includes(v) ? v : fallback
    }

    const { data, error: e } = await supabaseAdmin.rpc('get_payments_workspace', {
      p_status:  oneOf('status',  ['all', 'success', 'pending', 'failed'], 'all'),
      p_channel: oneOf('channel', ['all', 'online', 'manual'], 'all'),
      p_from:    day('from'),
      p_to:      day('to'),
      p_group:   /^[0-9a-f-]{36}$/i.test(u.searchParams.get('group') ?? '') ? u.searchParams.get('group') : null,
      // Capped, so a pathological search string cannot become an expensive scan.
      p_search:  (u.searchParams.get('q') ?? '').slice(0, 80) || null,
      p_min:     num('min'),
      p_max:     num('max'),
      p_page:    num('page') ?? 1,
      p_size:    num('size') ?? 25,
    })

    if (e) {
      // The caller gets something they can act on; the detail stays in the log.
      console.error('get_payments_workspace:', e.message)
      return error('We could not load payments. Please try again.', 502, req)
    }
    return json(data, 200, req)
  } catch (e) {
    console.error(e)
    return error('Something went wrong loading payments.', 500, req)
  }
})
