import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'
import { provider }                from '../_shared/mode.ts'
import { paymentStatus as naloStatus }   from '../_shared/nalo.ts'
import { applyPaymentToSchedule, claimTransaction } from '../_shared/settle.ts'
import { sendSMS, smsTemplates, notifyAdmins } from '../_shared/africas-talking.ts'

/*
 * The safety net: every few minutes, ask the provider about every payment we
 * are still waiting on, and settle the ones it now calls successful.
 *
 * Why this exists. A payment reaches us two ways — the provider's callback, or
 * the member's app polling for ~90 seconds. Both can miss: a callback can be
 * dropped or rejected, and polling stops when the member closes the screen.
 * The provider's status endpoint also lags, reporting PENDING for a while
 * after the money has actually moved, so a single check just after payment
 * proves nothing. Two payments made a minute apart can therefore land
 * differently — one settles, one doesn't — which is exactly what was happening.
 *
 * So we keep asking. A payment stays in the sweep for 48 hours, which is far
 * longer than the lag, and the moment the provider says success it is settled
 * with full spillover, a receipt to the member and a note to the admins.
 * Nothing here depends on anyone pasting transaction IDs.
 *
 * Runs on a schedule (CRON_SECRET) or on demand from an admin ("Sync now").
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const url = new URL(req.url)
  const secret = Deno.env.get('CRON_SECRET') ?? ''
  const provided = url.searchParams.get('key') ?? req.headers.get('x-cron-key') ?? ''
  if (!secret || provided !== secret) {
    const admin = await requireAdmin(req)
    if (!admin) return json({ error: 'unauthorized' }, 401)
  }

  const prov = provider()
  if (prov !== 'nalo') {
    return json({ error: `sweeper needs a phone-prompt provider; active: ${prov}` }, 400)
  }
  const getStatus = naloStatus

  const since = new Date(Date.now() - 48 * 3600e3).toISOString()
  const { data: pending, error: dbErr } = await supabaseAdmin
    .from('transactions')
    .select('id, reference, amount, type, related_id, batch_id, member_id, paystack_data, created_at')
    .eq('status', 'pending')
    .in('type', ['contribution', 'bulk_contribution', 'registration_fee'])
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(300)
  if (dbErr) return error(dbErr.message, 500)

  let settled = 0, stillPending = 0, noOrderId = 0
  const settledRows: any[] = []

  for (const tx of pending ?? []) {
    const orderId = (tx.paystack_data as { provider_order_id?: string } | null)?.provider_order_id
    const lookup = prov === 'nalo' ? orderId : tx.reference
    if (!lookup) { noOrderId++; continue }

    const s = await getStatus(lookup)
    if (!s || !s.settled) { stillPending++; continue }

    // Claim it first — if another path already settled this payment, stop
    // here rather than send a second receipt.
    if (!(await claimTransaction(tx.id, { swept: true }))) { continue }

    if (tx.batch_id) {
      await supabaseAdmin.from('contributions')
        .update({ status: 'paid', paid_at: new Date().toISOString(), paystack_ref: tx.reference })
        .eq('batch_id', tx.batch_id).neq('status', 'paid')
    } else if (tx.related_id) {
      await applyPaymentToSchedule(tx.related_id, Number(tx.amount ?? 0), tx.reference)
    }

    if (tx.type === 'registration_fee') {
      await supabaseAdmin.from('kyc_applications')
        .update({ registration_fee_paid: true })
        .eq('created_member_id', tx.member_id).eq('registration_fee_paid', false)
        .then(() => {}, () => {})
    }

    if (tx.member_id) {
      const { data: m } = await supabaseAdmin
        .from('members').select('full_name, phone').eq('id', tx.member_id).single()
      if (m?.phone) {
        let group = 'your susu'
        if (tx.related_id) {
          const { data: cc } = await supabaseAdmin
            .from('contributions').select('susu_groups(name)').eq('id', tx.related_id).single()
          group = (cc?.susu_groups as { name?: string } | null)?.name ?? group
        }
        await sendSMS(m.phone, smsTemplates.paymentConfirmedDetailed(
          m.full_name.split(' ')[0], Number(tx.amount).toFixed(2), group, 1))
        await notifyAdmins(smsTemplates.adminPaymentReceived(
          m.full_name, Number(tx.amount).toFixed(2), group))
        settledRows.push({ member: m.full_name, amount: Number(tx.amount), group })
      }
    }
    settled++
  }

  console.log(`sweep: checked ${pending?.length ?? 0}, settled ${settled}, still pending ${stillPending}`)
  return json({
    checked: pending?.length ?? 0,
    settled, still_pending: stillPending, no_order_id: noOrderId,
    details: settledRows,
    message: settled === 0
      ? `Nothing new — ${stillPending} payment(s) still awaiting confirmation from the provider.`
      : `${settled} payment(s) confirmed and recorded.`,
  })
})
