import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'
import { sendSMS }                 from '../_shared/africas-talking.ts'

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const cronSecret = req.headers.get('x-cron-secret')
  const isAdmin    = await requireAdmin(req)
  if (!isAdmin && cronSecret !== Deno.env.get('CRON_SECRET')) {
    return error('Unauthorized', 401)
  }

  try {
    const { data: flagCount } = await supabaseAdmin.rpc('flag_late_contributions')
    await supabaseAdmin.rpc('mark_overdue_contributions')

    const today = new Date().toISOString().split('T')[0]
    const { data: flaggedToday } = await supabaseAdmin
      .from('contributions')
      .select('member_id, amount, due_date, members(full_name, phone), susu_groups(name, penalty_per_late_day)')
      .eq('is_flagged', true)
      .gte('flagged_at', today + 'T00:00:00')

    let notified = 0
    for (const c of flaggedToday ?? []) {
      const member = c.members as { full_name: string; phone: string }
      const group  = c.susu_groups as { name: string; penalty_per_late_day: number }
      if (!member?.phone) continue
      const penaltyMsg = group.penalty_per_late_day > 0
        ? ' A penalty of GHS ' + group.penalty_per_late_day + ' has been applied.' : ''
      await sendSMS(member.phone,
        'SUSU ALERT: ' + member.full_name + ', your GHS ' + Number(c.amount).toFixed(2) +
        ' contribution for ' + group.name + ' was NOT received before 6PM and is now FLAGGED.' +
        penaltyMsg + ' Contact admin immediately.')
      notified++
    }

    return json({ flagged_count: flagCount ?? 0, notified })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
