import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin } from '../_shared/supabase-admin.ts'
import { requireMember } from '../_shared/jwt.ts'

/**
 * What would this payment cover?
 *
 * Answered by running the REAL settlement inside a rolled-back savepoint, so
 * the preview cannot disagree with what actually happens. Nothing is written.
 *
 * AUTHORIZATION. The membership id arrives from the browser and is therefore
 * untrusted. It is checked against the session member before anything else —
 * without that check this endpoint would reveal any member's obligations to
 * any other member by changing one field.
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST') return error('Method not allowed', 405)

  const session = await requireMember(req)
  if (!session) return error('Unauthorized', 401)

  try {
    const { membership_id, amount, this_group_only } = await req.json()
    if (!membership_id) return error('membership_id is required')

    const value = Number(amount)
    if (!isFinite(value) || value <= 0) return error('Enter an amount greater than zero')
    if (value > 1_000_000) return error('That amount is too large')

    // The membership must belong to the caller. This is the whole
    // authorization boundary for this endpoint.
    const { data: ms } = await supabaseAdmin
      .from('group_memberships')
      .select('id')
      .eq('id', membership_id)
      .eq('member_id', session.sub)
      .eq('status', 'active')
      .maybeSingle()
    if (!ms) return error('Membership not found', 404)

    const { data, error: rpcErr } = await supabaseAdmin.rpc('preview_payment_for_membership', {
      p_membership_id: membership_id,
      p_amount: Math.round(value * 100) / 100,
      p_this_only: this_group_only !== false,
    })
    if (rpcErr) return error(`Could not work out what this covers: ${rpcErr.message}`, 500)

    return json(data)
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
