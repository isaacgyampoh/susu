import { json, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }       from '../_shared/supabase-admin.ts'
import { sendSMS, notifyAdmins, smsTemplates } from '../_shared/africas-talking.ts'

/*
 * Payout reminders — run daily by Supabase Scheduler.
 *
 * For every upcoming payout scheduled for TOMORROW:
 *   - texts the member to be on standby,
 *   - texts the admins to prepare funds.
 *
 * Idempotent: a `reminded_at` stamp on the payout stops a second send if the
 * job runs twice. Secured by CRON_SECRET like the digest.
 */
serveWithCors(async (req) => {
  const url = new URL(req.url)
  const secret = Deno.env.get('CRON_SECRET') ?? ''
  const provided = url.searchParams.get('key') ?? req.headers.get('x-cron-key') ?? ''
  if (!secret || provided !== secret) return json({ error: 'unauthorized' }, 401)

  // Tomorrow's date (Ghana ~ UTC)
  const now = new Date()
  const tomorrow = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  const dateStr = tomorrow.toISOString().slice(0, 10)

  let { data: payouts, error: qErr } = await supabaseAdmin
    .from('payouts')
    .select('id, total_amount, scheduled_date, reminded_at, members!member_id(full_name, phone), susu_groups(name)')
    .eq('status', 'upcoming')
    .eq('scheduled_date', dateStr)
  if (qErr && /reminded_at/.test(qErr.message)) {
    // v20 not applied yet — run without the idempotency stamp
    ;({ data: payouts } = await supabaseAdmin
      .from('payouts')
      .select('id, total_amount, scheduled_date, members!member_id(full_name, phone), susu_groups(name)')
      .eq('status', 'upcoming')
      .eq('scheduled_date', dateStr))
  }

  let sent = 0
  for (const p of payouts ?? []) {
    if ((p as any).reminded_at) continue
    const member = (p as any).members
    const group  = (p as any).susu_groups?.name ?? 'your susu'
    const amount = Number(p.total_amount ?? 0).toFixed(2)
    const nice   = tomorrow.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

    if (member?.phone) {
      await sendSMS(member.phone, smsTemplates.payoutStandby(member.full_name.split(' ')[0], amount, nice, group))
    }
    await notifyAdmins(smsTemplates.adminPayoutDue(member?.full_name ?? 'a member', amount, nice, group))

    await supabaseAdmin.from('payouts')
      .update({ reminded_at: new Date().toISOString() })
      .eq('id', p.id)
      .then(({ error }) => { if (error) console.log('reminded_at skipped:', error.message) })
    sent++
  }

  return json({ date: dateStr, reminders_sent: sent })
})
