import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'
import { sendSMS, smsTemplates }   from '../_shared/africas-talking.ts'

const PORTAL_URL = Deno.env.get('FRONTEND_URL') ?? 'https://susuplatform.vercel.app'

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (req.method !== 'POST') return error('Method not allowed', 405)

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  try {
    const { group_id, start_date, force } = await req.json()
    if (!group_id || !start_date) return error('group_id and start_date are required')

    // Reject a start date in the past — it would back-date everyone as overdue
    const today = new Date().toISOString().split('T')[0]
    if (start_date < today && !force) {
      return error('Start date is in the past. Members would immediately be marked overdue.', 400)
    }

    const { error: activateErr } = await supabaseAdmin.rpc('activate_group', {
      p_group_id:   group_id,
      p_start_date: start_date,
      p_force:      !!force,
    })

    // The DB guards against rebuilding a schedule members have paid into
    if (activateErr) return error(activateErr.message, 409)

    // Notify all members in the group
    const { data: memberships } = await supabaseAdmin
      .from('group_memberships')
      .select('members(full_name, phone, member_id), payout_date, payout_amount')
      .eq('group_id', group_id)
      .eq('status', 'active')

    for (const m of memberships ?? []) {
      const member = m.members as { full_name: string; phone: string; member_id: string }
      if (!member?.phone) continue

      await sendSMS(
        member.phone,
        smsTemplates.payoutAlert(
          member.full_name,
          Number(m.payout_amount).toFixed(2),
          m.payout_date
        )
      )
    }

    return json({ message: 'Group activated. Contribution schedule generated and members notified.' })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
