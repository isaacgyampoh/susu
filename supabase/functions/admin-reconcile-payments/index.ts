import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'
import { paymentStatus as naloStatus }   from '../_shared/nalo.ts'
import { paymentStatus as moolreStatus } from '../_shared/moolre.ts'
import { provider }                from '../_shared/mode.ts'
import { sendSMS, smsTemplates, notifyAdmins } from '../_shared/africas-talking.ts'

/*
 * Reconcile pending payments against the provider.
 *
 * The webhook can miss (URL not set, network blip, provider delay). This
 * asks the provider the true status of every pending payment and settles the
 * ones that completed — so money confirmed at NaloPay always lands here too.
 * Safe to run repeatedly; already-settled rows are skipped.
 */
serveWithCors(async (req) => {
  const c = handleCors(req)
  if (c) return c
  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  const prov = provider()
  if (prov !== 'nalo' && prov !== 'moolre') return error(`Reconcile needs a phone-prompt provider. Active: ${prov}.`, 400)
  const getStatus = prov === 'nalo' ? naloStatus : moolreStatus

  // Pending payment transactions from the last 7 days
  const since = new Date(Date.now() - 7 * 864e5).toISOString()
  const { data: pending } = await supabaseAdmin
    .from('transactions')
    .select('id, reference, amount, type, related_id, batch_id, member_id, paystack_data, created_at')
    .eq('status', 'pending')
    .gte('created_at', since)

  const totalPending = pending?.length ?? 0
  const paymentPending = (pending ?? []).filter((t: any) =>
    ['contribution', 'bulk_contribution', 'registration_fee'].includes(t.type))

  let settled = 0, stillPending = 0, failed = 0, noOrderId = 0
  const details: any[] = []

  for (const tx of paymentPending) {
    const orderId = (tx.paystack_data as { provider_order_id?: string } | null)?.provider_order_id
    const lookup = prov === 'nalo' ? orderId : tx.reference
    if (prov === 'nalo' && !orderId) { noOrderId++; continue }

    const s = await getStatus(lookup!)
    if (!s) { stillPending++; continue }

    if (s.settled) {
      await settleTx(tx, s.raw)
      settled++
      details.push({ reference: tx.reference, amount: tx.amount, status: 'settled' })
    } else if (s.pending) {
      stillPending++
    } else {
      await supabaseAdmin.from('transactions').update({ status: 'failed' }).eq('id', tx.id)
      failed++
    }
  }

  return json({
    checked: paymentPending.length,
    total_pending_in_db: totalPending,
    settled, still_pending: stillPending, failed, no_order_id: noOrderId,
    hint: paymentPending.length === 0
      ? 'No pending payment transactions found. Either payments settled already, or the member portal is not creating payment intents — confirm the latest functions are deployed.'
      : undefined,
    details,
  })
})

async function settleTx(tx: any, raw: unknown) {
  // Mark the contribution(s) paid
  if (tx.batch_id) {
    await supabaseAdmin.from('contributions')
      .update({ status: 'paid', paid_at: new Date().toISOString(), paystack_ref: tx.reference })
      .eq('batch_id', tx.batch_id).neq('status', 'paid')
    const { data: ids } = await supabaseAdmin.from('contributions').select('id').eq('batch_id', tx.batch_id)
    if (ids?.length) {
      await supabaseAdmin.from('payment_penalties')
        .update({ is_paid: true, paid_at: new Date().toISOString() })
        .in('contribution_id', ids.map((r: { id: string }) => r.id))
    }
  } else if (tx.type === 'contribution' && tx.related_id) {
    await supabaseAdmin.from('contributions')
      .update({ status: 'paid', paid_at: new Date().toISOString(), paystack_ref: tx.reference })
      .eq('id', tx.related_id)
    await supabaseAdmin.from('payment_penalties')
      .update({ is_paid: true, paid_at: new Date().toISOString() })
      .eq('contribution_id', tx.related_id)
  }

  await supabaseAdmin.from('transactions')
    .update({ status: 'success', paystack_data: { ...(tx.paystack_data ?? {}), reconciled_raw: raw } as never })
    .eq('id', tx.id)

  if (tx.type === 'registration_fee') {
    await supabaseAdmin.from('kyc_applications')
      .update({ registration_fee_paid: true })
      .eq('created_member_id', tx.member_id).eq('registration_fee_paid', false)
      .then(() => {}, () => {})
  }

  // Receipts
  const { data: m } = await supabaseAdmin
    .from('members').select('full_name, phone').eq('id', tx.member_id).single()
  if (m?.phone) {
    let group = 'your susu', days = 1
    if (tx.batch_id) {
      const { data: rows } = await supabaseAdmin.from('contributions').select('susu_groups(name)').eq('batch_id', tx.batch_id)
      days = rows?.length ?? 1
      group = ((rows?.[0]?.susu_groups) as { name?: string } | null)?.name ?? group
    } else if (tx.related_id) {
      const { data: cc } = await supabaseAdmin.from('contributions').select('susu_groups(name)').eq('id', tx.related_id).single()
      group = (cc?.susu_groups as { name?: string } | null)?.name ?? group
    }
    await sendSMS(m.phone, smsTemplates.paymentConfirmedDetailed(m.full_name.split(' ')[0], Number(tx.amount).toFixed(2), group, days))
    await notifyAdmins(smsTemplates.adminPaymentReceived(m.full_name, Number(tx.amount).toFixed(2), group))
  }
}
