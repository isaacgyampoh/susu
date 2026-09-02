import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { hashPasscode, passcodeErrorResponse } from '../_shared/passcode.ts'
import { requireMember }           from '../_shared/jwt.ts'
import { sendSMS }                 from '../_shared/africas-talking.ts'

/*
 * A member replacing the admin-issued passcode with their own PIN.
 * They must prove the current passcode; the new one must be 6 digits.
 * A confirmation SMS goes out (never containing the PIN itself).
 *
 * Changing the passcode ENDS EVERY SESSION, including the caller's own.
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST') return error('Method not allowed', 405)

  const session = await requireMember(req)
  if (!session) return error('Unauthorized', 401)

  try {
    const { current_passcode, new_passcode } = await req.json()
    if (!current_passcode || !new_passcode) return error('Current and new passcode are required')
    if (!/^\d{6}$/.test(String(new_passcode)))  return error('Your new passcode must be exactly 6 digits')
    if (String(new_passcode) === String(current_passcode)) return error('Your new passcode must be different from the current one')
    if (/^(\d)\1{5}$/.test(String(new_passcode)) || String(new_passcode) === '123456') {
      return error('That passcode is too easy to guess — pick something less obvious')
    }

    const { data: member } = await supabaseAdmin
      .from('members').select('id, full_name, phone, token_version').eq('id', session.sub).single()
    if (!member) return error('Member not found', 404)

    // Prove they know the current passcode
    const { data: valid } = await supabaseAdmin.rpc('verify_member_passcode', {
      p_phone:    member.phone,
      p_passcode: String(current_passcode),
    })
    if (!valid || (Array.isArray(valid) && valid.length === 0)) {
      return error('Your current passcode is incorrect', 401)
    }

    /*
     * ── PHASE 08: CHANGING THE PASSCODE NOW ENDS EVERY SESSION ────────────
     *
     * It did not. The hash was replaced and existing tokens carried on
     * working for their full two-day life.
     *
     * That defeats the main reason a member changes their passcode. Somebody
     * who read it over their shoulder, or who was handed the phone, already
     * has a signed-in session — and changing the passcode locked them out of
     * signing in AGAIN while leaving the session they already had untouched.
     *
     * `token_version` is the mechanism, and it was already here: bumping it
     * invalidates every issued token, `session_is_current()` checks it on
     * every request, and the suspension trigger has always used it.
     * `change_admin_password()` bumps it too. Members were the only ones this
     * protection did not reach.
     *
     * The bump goes in the SAME update as the hash, so a session can never
     * survive a hash it no longer matches.
     */
    const hash = await hashPasscode(String(new_passcode))
    const { data: bumped, error: upErr } = await supabaseAdmin
      .from('members')
      .update({ passcode_hash: hash, token_version: (member.token_version ?? 0) + 1 })
      .eq('id', member.id)
      .eq('token_version', member.token_version ?? 0)   // nobody else changed it meanwhile
      .select('id')
    if (upErr) return error(upErr.message, 500)
    if (!(bumped ?? []).length) {
      return error('Your session changed while you were doing that. Sign in again and retry.', 409)
    }

    await sendSMS(member.phone,
      `Hi ${member.full_name.split(' ')[0]}, your Abbie Wealth Susu passcode was changed just now. If this wasn't you, contact us immediately on 0550302322.`)

    return json({
      message: 'Passcode changed. Please sign in again with your new passcode.',
      // The caller's own token has just been invalidated along with everyone
      // else's, so the portal must send them back to the sign-in screen.
      session_ended: true,
    })
  } catch (e) {
    const pc = passcodeErrorResponse(e, error)
    if (pc) return pc
    console.error(e)
    return error('Internal server error', 500)
  }
})
