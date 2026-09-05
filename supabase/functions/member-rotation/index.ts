import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireMember }           from '../_shared/jwt.ts'

/**
 * THE ROTATION, AS A MEMBER IS ALLOWED TO SEE IT.
 *
 *   GET ?membership=<uuid>   one of the caller's own memberships (optional)
 *
 * ────────────────────────────────────────────────────────────────────────
 * ── THE PRIVACY IS IN THE QUERY, NOT IN THIS FILE ───────────────────────
 *
 * `get_member_rotation` does not join the `members` table at all, so there is
 * no name, phone, email or Ghana Card in the result to filter out here. That is
 * deliberate: filtering in the endpoint means the private data still travelled
 * out of the database, and one careless edit later it travels one step further.
 *
 * Another member's `payout_amount` is likewise NULL at source. What somebody
 * else collects is their business; a rotation needs position, date and status.
 *
 * The member id passed down comes from the VERIFIED SESSION and never from the
 * request. `?membership=` selects which of the caller's own memberships to show
 * the rotation for — it does not grant access to one, because the function
 * matches it against that member's rows.
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'GET') return error('Method not allowed', 405, req)

  const session = await requireMember(req)
  if (!session) return error('Unauthorized', 401, req)

  try {
    const raw = new URL(req.url).searchParams.get('membership')
    const membership = raw && /^[0-9a-f-]{36}$/i.test(raw) ? raw : null

    const { data, error: e } = await supabaseAdmin.rpc('get_member_rotation', {
      p_member_id: session.sub,
      p_membership_id: membership,
    })

    if (e) {
      console.error('get_member_rotation:', e.message)
      return error('We could not load the rotation. Please try again.', 502, req)
    }

    // No membership, or one that is not theirs — the same answer either way.
    if (!data) return json({ rotation: null }, 200, req)

    return json({ rotation: data }, 200, req)
  } catch (e) {
    console.error(e)
    return error('Something went wrong loading the rotation.', 500, req)
  }
})
