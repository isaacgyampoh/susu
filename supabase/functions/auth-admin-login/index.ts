import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { signJWT }                 from '../_shared/jwt.ts'

/**
 * ADMINISTRATOR SIGN-IN — PIN ONLY.
 *
 * ────────────────────────────────────────────────────────────────────────
 * This endpoint used to take an email and a password. It now takes four
 * digits and nothing else. The credential store did not change: the PIN is
 * still a bcrypt hash in `admin_users.password_hash`, still compared by the
 * database, still never in this process's memory beyond the length of one
 * request. What changed is that there is no longer an identifier to send with
 * it — so the PIN is now both who you are and what you know.
 *
 * That collapse is the whole security story of this file, and it costs three
 * things that the email version got for free:
 *
 *   IDENTITY IS NO LONGER UNIQUE. Two admins with the same four digits are
 *   indistinguishable. `verify_admin_pin()` returns nothing rather than pick
 *   one, and `admin_pin_is_taken()` stops the collision being created.
 *
 *   THE SEARCH SPACE IS 10,000. An email login leans on password entropy;
 *   this leans entirely on the gate below. Without it, the console falls to a
 *   laptop in an afternoon.
 *
 *   THE LOCKOUT KEY IS NO LONGER ATTACKER-SUPPLIED. Keying it on "the admin
 *   login" would let any stranger lock the only administrator out. So the gate
 *   counts per source AND globally, at different thresholds — see
 *   `check_admin_pin_gate()` for why those two numbers are what they are.
 *
 * The PIN is never logged, never echoed, and never returned. The failure
 * message says nothing about whether four digits were close to anything.
 * ────────────────────────────────────────────────────────────────────────
 */

/** Trust the platform's proxy header; fall back to something rather than nothing. */
function sourceOf(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  const ip  = fwd?.split(',')[0]?.trim()
  return ip && ip.length > 0 ? ip : (req.headers.get('cf-connecting-ip') ?? 'unknown')
}

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (req.method !== 'POST') return error('Method not allowed', 405)

  const source = sourceOf(req)

  try {
    const body = await req.json().catch(() => ({}))
    const pin  = typeof body?.pin === 'string' ? body.pin.trim() : ''

    // Shape is checked here so a malformed request never reaches the hash
    // comparison — and never spends one of the caller's five attempts on
    // something that could not have been a PIN in the first place.
    if (!/^\d{4}$/.test(pin)) return error('Enter your 4-digit PIN', 400)

    const { data: gate } = await supabaseAdmin.rpc('check_admin_pin_gate', { p_source: source })
    if (gate?.[0] && !gate[0].allowed) {
      const mins = Math.ceil((gate[0].retry_after_seconds ?? 900) / 60)
      return error(`Too many attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`, 429)
    }

    const { data, error: dbErr } = await supabaseAdmin.rpc('verify_admin_pin', { p_pin: pin })

    // No match, or an AMBIGUOUS match. Both land here, and the caller is told
    // the same thing: a response that distinguished them would confirm that a
    // PIN is in use.
    if (dbErr || !data || data.length !== 1) {
      if (dbErr) console.error('verify_admin_pin failed:', dbErr.message)
      await supabaseAdmin.rpc('record_login_attempt', {
        p_identifier: source, p_kind: 'admin_pin', p_ok: false,
      })
      return error('Incorrect PIN', 401)
    }

    await supabaseAdmin.rpc('record_login_attempt', {
      p_identifier: source, p_kind: 'admin_pin', p_ok: true,
    })

    const admin = data[0]

    /*
     * ── AN UNCHANGED INITIAL PIN MUST NOT BUY A WORKING ADMIN TOKEN ───────
     *
     * While `must_change_password` is set, the token is STAMPED with
     * `pw: 'must_change'`, and `requireAdmin()` refuses it everywhere except
     * the PIN-change endpoint. The credential still opens the door, and the
     * only room it reaches is the one where you change it.
     *
     * This is not a substitute for changing a shipped PIN. It is what closes
     * the window until somebody does.
     */
    const mustChange = admin.must_change_password ?? false
    const token = await signJWT({
      sub:       admin.id,
      email:     admin.email,
      full_name: admin.full_name,
      role:      admin.role,
      tv:        admin.token_version ?? 0,
      type:      'admin',
      ...(mustChange ? { pw: 'must_change' } : {}),
    })

    return json({
      token,
      admin: {
        id: admin.id, email: admin.email, full_name: admin.full_name, role: admin.role,
        must_change_password: mustChange,
      },
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
