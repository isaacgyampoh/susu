import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'
import { sendSMS }                 from '../_shared/africas-talking.ts'

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST') return error('Method not allowed', 405)

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  try {
    const { membership_id, reason, notify } = await req.json()
    if (!membership_id || !reason) return error('membership_id and reason are required')

    const { data: m } = await supabaseAdmin
      .from('group_memberships')
      .select('*, members(id, member_id, full_name, phone), susu_groups(name)')
      .eq('id', membership_id).single()

    if (!m) return error('Membership not found', 404)

    const { error: fErr } = await supabaseAdmin.rpc('forfeit_membership', {
      p_membership_id: membership_id,
      p_reason: reason,
      p_admin_id: admin.sub,
    })
    if (fErr) return error(fErr.message, 400)

    const member = m.members as any
    if (notify !== false) {
      await sendSMS(member.phone,
        `${member.full_name}, your slot in ${(m.susu_groups as any).name} has been forfeited due to: ${reason}. Per the platform rules, no refund applies. Contact admin for details.`)
    }

    await supabaseAdmin.from('audit_log').insert({
      admin_id: admin.sub, admin_name: admin.full_name ?? admin.email,
      action: 'membership.forfeited', entity_type: 'member', entity_id: member.id,
      entity_label: `${member.member_id} — ${member.full_name}`,
      details: { group: (m.susu_groups as any).name, position: m.payout_position, reason },
    })

    return json({ message: 'Membership forfeited. Slot is now free.' })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
