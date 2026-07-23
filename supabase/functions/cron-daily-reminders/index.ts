import { json, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }       from '../_shared/supabase-admin.ts'
import { requireAdmin }        from '../_shared/jwt.ts'
import { sendSMS }             from '../_shared/africas-talking.ts'
import { requestPayment as naloRequest } from '../_shared/nalo.ts'
import { requestPayment as moolreRequest } from '../_shared/moolre.ts'
import { provider, withServiceCharge } from '../_shared/mode.ts'

/*
 * Daily payment reminder (Supabase Scheduler, e.g. 07:00 Africa/Accra).
 *
 * For every member with something due today, this creates a mobile-money
 * charge for each group they owe and texts them the dial-code to approve —
 * so a member with no data can pay straight from the SMS. One person in two
 * groups gets one SMS per group (each group is its own payout, its own code).
 *
 * The dial code (USSD) is issued per-charge by the provider, so it must be
 * generated fresh here — it can't be pre-computed.
 *
 * Secured by CRON_SECRET. To avoid double-charging if run twice, it skips a
 * contribution that already has a pending charge from today.
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

  const prov = provider()
  if (prov !== 'nalo' && prov !== 'moolre') {
    return json({ error: 'reminder needs a phone-prompt provider', provider: prov }, 400)
  }
  const doReq = prov === 'nalo' ? naloRequest : moolreRequest

  const today = new Date().toISOString().slice(0, 10)

  // Contributions due today (or overdue) that are still unpaid, with member + group
  const { data: due } = await supabaseAdmin
    .from('contributions')
    .select('id, amount, penalty_due, member_id, group_id, due_date, status, membership_id, ' +
            'members!member_id(full_name, phone, mobile_money_number, mobile_money_provider, status), ' +
            'susu_groups(name)')
    .in('status', ['pending', 'overdue'])
    .lte('due_date', today)

  // Group by member+group so one prompt covers what they owe in that group today
  type Bucket = { member_id: string; member: any; group: any; ids: string[]; amount: number; penalty: number }
  const buckets = new Map<string, Bucket>()
  for (const c of due ?? []) {
    const m = (c as any).members
    if (!m || m.status !== 'active' || !m.phone) continue
    const key = `${c.member_id}:${c.group_id}`
    if (!buckets.has(key)) {
      buckets.set(key, { member_id: c.member_id, member: m, group: (c as any).susu_groups, ids: [], amount: 0, penalty: 0 })
    }
    const bk = buckets.get(key)!
    // Only settle the SINGLE oldest due day per group in the daily nudge, to
    // keep the amount equal to one day's contribution (not their whole arrears).
    if (bk.ids.length === 0) {
      bk.ids.push(c.id)
      bk.amount += Number(c.amount)
      bk.penalty += Number(c.penalty_due ?? 0)
    }
  }

  let texted = 0, skipped = 0
  for (const bk of buckets.values()) {
    const oldest = bk.ids[0]

    // Skip if a pending charge for this contribution already exists today
    const { data: existing } = await supabaseAdmin
      .from('transactions').select('id')
      .eq('related_id', oldest).eq('status', 'pending')
      .gte('created_at', `${today}T00:00:00Z`).maybeSingle()
    if (existing) { skipped++; continue }

    const base = bk.amount + bk.penalty
    const { charged } = withServiceCharge(base)
    const momo = bk.member.mobile_money_number || bk.member.phone
    const net  = bk.member.mobile_money_provider || 'MTN'
    const ref  = `DAY-${oldest}-${Date.now()}`
    const providerRef = `DY${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase().slice(0, 20)

    await supabaseAdmin.from('transactions').insert({
      member_id: bk.member_id, type: 'contribution', amount: base,
      reference: ref, related_id: oldest, status: 'pending',
      description: `Daily reminder charge for ${bk.group?.name ?? 'susu'} (${today})`,
    }).then(() => {}, () => {})

    const res = await doReq({
      payer: momo, amount: charged, provider: net,
      externalref: prov === 'nalo' ? providerRef : ref,
      reference: 'Susu contribution', accountName: bk.member.full_name,
    })

    if (res.kind === 'prompted') {
      if (res.moolreRef) {
        await supabaseAdmin.from('transactions')
          .update({ paystack_data: { provider_order_id: res.moolreRef } as never })
          .eq('reference', ref)
      }
      const first = bk.member.full_name.split(' ')[0]
      const line = res.ussd
        ? `Hi ${first}, to pay your ${bk.group?.name ?? 'susu'} contribution of GHS ${charged.toFixed(2)} today, dial ${res.ussd} and approve with your MoMo PIN. Thank you! — Abbie Wealth`
        : `Hi ${first}, a prompt to pay GHS ${charged.toFixed(2)} for ${bk.group?.name ?? 'susu'} has been sent to ${momo}. Approve with your MoMo PIN. — Abbie Wealth`
      await sendSMS(bk.member.phone, line)
      texted++
    } else {
      // Charge couldn't start — clean up the pending row so tomorrow retries
      await supabaseAdmin.from('transactions').update({ status: 'failed' }).eq('reference', ref)
      skipped++
    }
  }

  return json({ date: today, texted, skipped })
})
