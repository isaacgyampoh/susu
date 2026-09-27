import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin } from '../_shared/supabase-admin.ts'
import { signJWT } from '../_shared/jwt.ts'
import { rateLimit, tooManyMessage } from '../_shared/rate-limit.ts'

/**
 * A CUSTOMER OPENS AN ACCOUNT.
 *
 *   POST { full_name, phone, passcode, email? }
 *
 * ────────────────────────────────────────────────────────────────────────
 * Public, so it is rate limited on the caller's source: this endpoint creates
 * rows in `members`, and an unmetered create is how a table fills with
 * thousands of junk accounts overnight.
 *
 * ── A KNOWN PHONE IS NOT AN ERROR, AND NOT A LOGIN ──────────────────────
 *
 * Somebody who saves with the susu and then buys a television is ONE person —
 * two member rows would split their history in half. So a known number returns
 * "please sign in" and nothing else. It deliberately does NOT set the passcode
 * or issue a session: doing either would let anyone who knows a member's phone
 * number take their account, which is the whole attack this endpoint could
 * otherwise become.
 *
 * Ghana Card is not collected. It stayed NOT NULL for years because a susu
 * member receives real money on their turn; somebody paying off a kettle is a
 * different risk, and v59 made the column nullable rather than asking every
 * shopper to photograph their ID.
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST') return error('Method not allowed', 405, req)

  const gate = await rateLimit(req, 'shop-signup', 5, 60)
  if (!gate.allowed) {
    return error(tooManyMessage(gate.retryAfterSeconds, 'sign-up attempts from this device'), 429, req)
  }

  try {
    const body = await req.json().catch(() => null)
    if (!body) return error('Expected a JSON body', 400, req)

    const { full_name, phone, passcode, email } = body
    if (!full_name || !phone || !passcode) {
      return error('Your name, phone number and a passcode are required', 400, req)
    }

    // Stored the way every other member's phone is, so one person is one row.
    const normalised = String(phone).trim().replace(/^0/, '+233').replace(/^\+?233/, '+233')

    const { data, error: e } = await supabaseAdmin.rpc('register_shop_customer', {
      p_full_name: String(full_name),
      p_phone:     normalised,
      p_passcode:  String(passcode),
      p_email:     email ? String(email) : null,
    })

    if (e) {
      // The database raises the wording a customer should read.
      return error(e.message, 400, req)
    }

    if (data?.existing) {
      return json({ existing: true, message: data.message }, 200, req)
    }

    const token = await signJWT({ sub: data.member_id, role: 'member' })
    return json({
      existing: false,
      member_id: data.member_id,
      member_code: data.member_code,
      token,
    }, 201, req)
  } catch (e) {
    console.error(e)
    return error('We could not create your account. Please try again.', 500, req)
  }
})
