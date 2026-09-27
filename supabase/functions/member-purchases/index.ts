import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin } from '../_shared/supabase-admin.ts'
import { requireMember } from '../_shared/jwt.ts'

/**
 * WHAT THIS CUSTOMER IS PAYING FOR.
 *
 *   GET                 every purchase they hold
 *   GET ?id=<uuid>      one purchase in full: schedule, payments, fulfilment
 *
 * ────────────────────────────────────────────────────────────────────────
 * The member id comes from the VERIFIED SESSION, never from the request, and
 * `get_purchase_detail` matches on member AND purchase. Changing the id in the
 * URL returns nothing rather than somebody else's television — the filter is
 * in SQL, so no edit to this file can widen it.
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'GET') return error('Method not allowed', 405, req)

  const session = await requireMember(req)
  if (!session) return error('Unauthorized', 401, req)

  try {
    const raw = new URL(req.url).searchParams.get('id')
    const id = raw && /^[0-9a-f-]{36}$/i.test(raw) ? raw : null

    if (id) {
      const { data, error: e } = await supabaseAdmin.rpc('get_purchase_detail', {
        p_member_id: session.sub, p_purchase_id: id,
      })
      if (e) {
        console.error('get_purchase_detail:', e.message)
        return error('We could not load that purchase.', 502, req)
      }
      // Not theirs, or not a purchase. The same answer either way, so the
      // response cannot be used to discover which ids exist.
      if (!data) return json({ purchase: null }, 404, req)
      return json(data, 200, req)
    }

    const { data, error: e } = await supabaseAdmin
      .rpc('get_member_purchases', { p_member_id: session.sub })
    if (e) {
      console.error('get_member_purchases:', e.message)
      return error('We could not load your purchases.', 502, req)
    }
    return json(data ?? { totals: {}, purchases: [] }, 200, req)
  } catch (e) {
    console.error(e)
    return error('Something went wrong loading your purchases.', 500, req)
  }
})
