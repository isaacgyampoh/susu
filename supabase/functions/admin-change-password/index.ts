import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'

/**
 * CHANGE THE ADMINISTRATOR PIN.
 *
 * Sign-in is now four digits, so this endpoint validates four digits. The old
 * rule here was `length < 10`, which would have rejected every PIN a person
 * could actually sign in with — leaving the console permanently stuck on
 * whatever PIN it shipped with.
 *
 * WHAT THIS FILE DOES NOT DECIDE.
 *
 * Which PINs are acceptable — the shape, the shipped default, trivial runs and
 * repeated digits, and collisions with another administrator — is decided by
 * `change_admin_password()` in the database, and its refusal message is passed
 * straight back to the caller below. An earlier draft of this endpoint checked
 * those rules here as well. That is how validation drifts: a rule tightened in
 * one layer and left loose in another, with no way to tell which one is the
 * real policy.
 *
 * The shape check below is the one exception, and it is not a policy decision —
 * it is a cheap early exit so an obviously malformed request never reaches the
 * hash comparison.
 */

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST') return error('Method not allowed', 405, req)

  // The ONE endpoint that accepts a token issued against an unchanged initial
  // PIN — otherwise the account could never get out of the state.
  const admin = await requireAdmin(req, true)
  if (!admin) return error('Unauthorized', 401, req)

  try {
    const body = await req.json().catch(() => ({}))
    // `current_password` / `new_password` are kept as the wire names so an
    // older client is not silently rejected; `current_pin` / `new_pin` are what
    // the console sends now.
    const current = String(body?.current_pin ?? body?.current_password ?? '').trim()
    const next    = String(body?.new_pin     ?? body?.new_password     ?? '').trim()

    if (!current || !next) return error('Enter your current PIN and a new one', 400, req)
    if (!/^\d{4}$/.test(next)) return error('Your new PIN must be exactly 4 digits', 400, req)
    if (next === current)      return error('Choose a PIN you have not used', 400, req)

    const { data, error: e } = await supabaseAdmin.rpc('change_admin_password', {
      p_admin_id: admin.sub,
      p_current:  current,
      p_new:      next,
    })
    if (e) return error(e.message, 400, req)
    if (data !== true) return error('Your current PIN is incorrect', 401, req)

    await supabaseAdmin.from('audit_log').insert({
      admin_id: admin.sub, admin_name: admin.full_name ?? admin.email,
      action: 'admin.pin_changed', entity_type: 'admin', entity_id: admin.sub,
      entity_label: (admin.email as string) ?? '',
    })

    // Changing the PIN bumped token_version — this session is now dead too.
    return json({ message: 'PIN changed. Please sign in again.' }, 200, req)
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500, req)
  }
})
