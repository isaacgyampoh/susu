import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireMember }           from '../_shared/jwt.ts'
import { sendSMS }                 from '../_shared/africas-talking.ts'

/*
 * A member replacing the admin-issued passcode with their own PIN.
 * They must prove the current passcode; the new one must be 6 digits.
 * A confirmation SMS goes out (never containing the PIN itself).
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
      .from('members').select('id, full_name, phone').eq('id', session.sub).single()
    if (!member) return error('Member not found', 404)

    // Prove they know the current passcode
    const { data: valid } = await supabaseAdmin.rpc('verify_member_passcode', {
      p_phone:    member.phone,
      p_passcode: String(current_passcode),
    })
    if (!valid || (Array.isArray(valid) && valid.length === 0)) {
      return error('Your current passcode is incorrect', 401)
    }

    const { data: hash } = await supabaseAdmin.rpc('hash_passcode', { p_passcode: String(new_passcode) })
    const { error: upErr } = await supabaseAdmin
      .from('members').update({ passcode_hash: hash ?? String(new_passcode) }).eq('id', member.id)
    if (upErr) return error(upErr.message, 500)

    await sendSMS(member.phone,
      `Hi ${member.full_name.split(' ')[0]}, your Abbie Wealth Susu passcode was changed just now. If this wasn't you, contact us immediately on 0550302322.`)

    return json({ message: 'Passcode changed. Use your new passcode next time you sign in.' })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
