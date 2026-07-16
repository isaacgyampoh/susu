import { handleCors, json, error } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { signJWT }                 from '../_shared/jwt.ts'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (req.method !== 'POST') return error('Method not allowed', 405)

  try {
    const { phone, passcode } = await req.json()

    if (!phone || !passcode) return error('Phone and passcode are required')

    const normalised = phone.trim().replace(/^0/, '+233').replace(/^\+?233/, '+233')

    // A 6-digit passcode is a million combinations. Rate limit it.
    const { data: gate } = await supabaseAdmin.rpc('check_login_allowed', {
      p_identifier: normalised, p_kind: 'member',
    })
    if (gate?.[0] && !gate[0].allowed) {
      const mins = Math.ceil((gate[0].retry_after_seconds ?? 900) / 60)
      return error(`Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`, 429)
    }

    const { data, error: dbErr } = await supabaseAdmin.rpc('verify_member_passcode', {
      p_phone:    normalised,
      p_passcode: String(passcode),
    })

    if (dbErr || !data || data.length === 0) {
      await supabaseAdmin.rpc('record_login_attempt', {
        p_identifier: normalised, p_kind: 'member', p_ok: false,
      })
      return error('Invalid phone or passcode', 401)
    }

    await supabaseAdmin.rpc('record_login_attempt', {
      p_identifier: normalised, p_kind: 'member', p_ok: true,
    })

    const member = data[0]

    const token = await signJWT({
      sub:       member.id,
      member_id: member.member_id,
      full_name: member.full_name,
      phone:     member.phone,
      tv:        member.token_version ?? 0,
      type:      'member',
    })

    return json({
      token,
      member: {
        id:        member.id,
        member_id: member.member_id,
        full_name: member.full_name,
        phone:     member.phone,
        status:    member.status,
      },
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
