import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin } from '../_shared/supabase-admin.ts'
import { requireMember } from '../_shared/jwt.ts'

/**
 * A member's statement, per membership, over a date range.
 *
 * Aggregated entirely in the database. The range is validated and bounded
 * SERVER-side — a client cannot widen it, and cannot filter by choosing which
 * membership to look at, because ownership is checked here first.
 *
 * The statement reports `attribution_complete: false` for periods before the
 * allocation ledger existed (24 July 2026). Four of the five legacy settlement
 * paths never recorded which payment covered which day, so for earlier periods
 * the statement can say when a day was settled but not by which payment.
 * Inferring that from amounts and dates would be a guess presented as a fact.
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const session = await requireMember(req)
  if (!session) return error('Unauthorized', 401)

  try {
    const url = new URL(req.url)
    const from = url.searchParams.get('from')
    const to   = url.searchParams.get('to')
    const membershipId = url.searchParams.get('membership_id')

    if (!from || !to) return error('from and to dates are required')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return error('Dates must be YYYY-MM-DD')
    }
    if (to < from) return error('The end date is before the start date')

    // A membership filter must belong to the caller. Without this check the
    // parameter would read any member's statement.
    if (membershipId) {
      const { data: ms } = await supabaseAdmin
        .from('group_memberships').select('id')
        .eq('id', membershipId).eq('member_id', session.sub)
        .maybeSingle()
      if (!ms) return error('Membership not found', 404)
    }

    const { data, error: rpcErr } = await supabaseAdmin.rpc('get_member_statement', {
      p_member_id: session.sub,
      p_from: from,
      p_to: to,
      p_membership_id: membershipId ?? null,
    })
    if (rpcErr) return error(rpcErr.message, 400)

    return json(data)
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
