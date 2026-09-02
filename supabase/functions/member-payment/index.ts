import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireMember }           from '../_shared/jwt.ts'

/**
 * ONE OF THE MEMBER'S OWN PAYMENTS.
 *
 * GET ?ref=<our payment reference>
 *
 * ────────────────────────────────────────────────────────────────────────
 * The member id passed to the database comes from the VERIFIED SESSION TOKEN
 * and never from the request. The reference in the query string selects a
 * record; it does not grant access to one. Inside `get_member_payment` the
 * member id sits in the WHERE clause rather than in a comparison afterwards,
 * so a reference belonging to somebody else matches no row and the caller gets
 * a 404 — the same answer they get for a reference that does not exist, which
 * is deliberate: distinguishing the two would confirm that a stranger's
 * payment reference is real.
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'GET') return error('Method not allowed', 405, req)

  const session = await requireMember(req)
  if (!session) return error('Unauthorized', 401, req)

  try {
    const ref = (new URL(req.url).searchParams.get('ref') ?? '').trim()
    if (!ref || ref.length > 120) return error('Payment not found', 404, req)

    const { data, error: e } = await supabaseAdmin.rpc('get_member_payment', {
      p_member_id: session.sub,
      p_reference: ref,
    })

    if (e) {
      // The member gets something they can act on; the detail stays in the log.
      console.error('get_member_payment:', e.message)
      return error('We could not load this payment. Please try again.', 502, req)
    }
    if (!data) return error('Payment not found', 404, req)

    return json(data, 200, req)
  } catch (e) {
    console.error(e)
    return error('Something went wrong loading this payment.', 500, req)
  }
})
