import { json, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }       from '../_shared/supabase-admin.ts'
import { requireAdmin }        from '../_shared/jwt.ts'
import { notifyAdmins, smsTemplates } from '../_shared/africas-talking.ts'

/*
 * Daily payment digest — run by Supabase Scheduler (e.g. 20:00 Africa/Accra).
 * Sums the day's successful payments and texts the admins one summary.
 *
 * Secured by CRON_SECRET: the scheduled request must send ?key=<CRON_SECRET>
 * (or an x-cron-key header). Without a matching secret it refuses, so the
 * endpoint can't be triggered by anyone who finds the URL.
 */
serveWithCors(async (req) => {
  const url = new URL(req.url)
  const secret = Deno.env.get('CRON_SECRET') ?? ''
  const provided = url.searchParams.get('key') ?? req.headers.get('x-cron-key') ?? ''
  // Two doors: the scheduler's secret, or a signed-in admin (for "Run now")
  if (!secret || provided !== secret) {
    const admin = await requireAdmin(req)
    if (!admin) return json({ error: 'unauthorized' }, 401)
  }

  // "Today" in Ghana (UTC+0, so date is straightforward)
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0))
  const dateLabel = start.toISOString().slice(0, 10)

  const { data: txns } = await supabaseAdmin
    .from('transactions')
    .select('amount, type')
    .eq('status', 'success')
    .in('type', ['contribution', 'bulk_contribution'])
    .gte('created_at', start.toISOString())

  const count = txns?.length ?? 0
  const total = (txns ?? []).reduce((s: number, t: any) => s + Number(t.amount ?? 0), 0)

  if (count > 0) {
    await notifyAdmins(smsTemplates.adminDailyDigest(count, total.toFixed(2), dateLabel))
  }

  return json({ date: dateLabel, count, total })
})
