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

    const { data, error: dbErr } = await supabaseAdmin.rpc('verify_member_passcode', {
      p_phone:    normalised,
      p_passcode: String(passcode),
    })

    if (dbErr || !data || data.length === 0) {
      return error('Invalid phone or passcode', 401)
    }

    const member = data[0]

    const token = await signJWT({
      sub:       member.id,
      member_id: member.member_id,
      full_name: member.full_name,
      phone:     member.phone,
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
