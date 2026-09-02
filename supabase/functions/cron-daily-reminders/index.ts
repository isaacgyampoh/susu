import { json, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }       from '../_shared/supabase-admin.ts'
import { requireAdmin }        from '../_shared/jwt.ts'
import { sendSMS }             from '../_shared/africas-talking.ts'
import { requestPayment as naloRequest } from '../_shared/nalo.ts'
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

  /*
   * ── DRY RUN ──────────────────────────────────────────────────────────
   *
   * This job was invoked by hand during an endpoint audit. It did precisely
   * what it is built to do: 66 real SMS messages and 65 real NaloPay prompts —
   * around GHS 5,350 of payment intents — to real members, at the wrong time
   * of day. Nothing malfunctioned. The auditor simply had no way to look at
   * this job and learn what calling it would cost.
   *
   * `dry_run` is that way. It walks exactly the same query and the same
   * bucketing, and reports who WOULD be charged and how much, without touching
   * the provider, the phone network or the transactions table.
   *
   * The scheduler never sends it, so the real 07:00 path is byte-for-byte what
   * it was. This exists for the person holding an admin token who wants to know
   * what the button does before pressing it.
   */
  const dryRun = url.searchParams.get('dry_run') === '1' ||
                 url.searchParams.get('dry_run') === 'true'

  const prov = provider()
  if (prov !== 'nalo' && !dryRun) {
    return json({ error: 'reminder needs a phone-prompt provider', provider: prov }, 400)
  }
  const doReq = naloRequest

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
  const wouldCharge: { member: string; group: string; amount: number }[] = []

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

    // Everything below this line contacts the outside world. A dry run stops
    // here, having done all the reading and none of the charging.
    if (dryRun) {
      wouldCharge.push({
        member: bk.member.full_name,
        group:  bk.group?.name ?? 'susu',
        amount: charged,
      })
      continue
    }

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
      if (res.providerOrderId) {
        await supabaseAdmin.from('transactions')
          .update({ paystack_data: { provider_order_id: res.providerOrderId } as never })
          .eq('reference', ref)
      }
      const first = bk.member.full_name.split(' ')[0]
      const line = res.ussd
        ? `Hi ${first}, to pay your ${bk.group?.name ?? 'susu'} contribution of GHS ${charged.toFixed(2)} today, dial ${res.ussd} and approve with your MoMo PIN. Thank you! — Abbie Wealth`
        : `Hi ${first}, a prompt to pay GHS ${charged.toFixed(2)} for ${bk.group?.name ?? 'susu'} has been sent to ${momo}. Approve with your MoMo PIN. — Abbie Wealth`
      await sendSMS(bk.member.phone, line)
      texted++
    } else {
      // The prompt couldn't be raised (a provider hiccup, a bad number). The
      // member must still be reminded — send a plain reminder with the amount
      // and how to pay, rather than going silent. Clean up the dead charge so
      // tomorrow retries the prompt.
      await supabaseAdmin.from('transactions').update({ status: 'failed' }).eq('reference', ref)
      const first = bk.member.full_name.split(' ')[0]
      await sendSMS(bk.member.phone,
        `Hi ${first}, your ${bk.group?.name ?? 'susu'} contribution of GHS ${base.toFixed(2)} is due today. ` +
        `Open your portal to pay, or reply/visit to pay by MoMo or cash. Thank you! — Abbie Wealth`)
      texted++
    }
  }

  if (dryRun) {
    return json({
      dry_run: true,
      date: today,
      would_prompt: wouldCharge.length,
      would_charge_total: Math.round(wouldCharge.reduce((t, w) => t + w.amount, 0) * 100) / 100,
      already_pending_today: skipped,
      detail: wouldCharge,
      note: 'Nothing was sent and no payment intent was created.',
    })
  }

  return json({ date: today, texted, skipped })
})
