import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }         from '../_shared/supabase-admin.ts'
import { requireMember }         from '../_shared/jwt.ts'
import { paymentStatus as naloStatus }   from '../_shared/nalo.ts'
import { provider, paymentsUnavailable } from '../_shared/mode.ts'
import { sendSMS, smsTemplates, notifyAdmins } from '../_shared/africas-talking.ts'
import { applyPaymentToSchedule, claimTransaction } from '../_shared/settle.ts'

/**
 * The member's app polls this after approving a prompt.
 *
 * With no trustworthy webhook, this is not a convenience — it is how a payment
 * gets settled at all. The phone asks "did it land?", we ask NaloPay, and the
 * answer decides.
 */
/** A single payment or a whole batch — settle whatever this reference covers. */

// Allocation from the most recent settlement, so the receipt can describe it
let lastSpread: { daysCleared: number; partBanked: number; unallocated: number; groups: string[] } | null = null

async function settleLocally(reference: string, tx: any, raw: unknown): Promise<boolean> {
  // Claim first: the callback or the sweeper may already have settled this,
  // and a second receipt reads to the member as a second charge.
  if (!(await claimTransaction(tx.id, { settled_raw: raw }))) return false

  if (tx.batch_id) {
    // Paying ahead: one approval clears every day in the batch
    await supabaseAdmin.from('contributions')
      .update({ status: 'paid', paid_at: new Date().toISOString(), paystack_ref: reference })
      .eq('batch_id', tx.batch_id).neq('status', 'paid')
    const { data: ids } = await supabaseAdmin
      .from('contributions').select('id').eq('batch_id', tx.batch_id)
    if (ids?.length) {
      await supabaseAdmin.from('payment_penalties')
        .update({ is_paid: true, paid_at: new Date().toISOString() })
        .in('contribution_id', ids.map((r: { id: string }) => r.id))
    }
  } else if (tx.type === 'contribution' && tx.related_id) {
    lastSpread = await applyPaymentToSchedule(tx.related_id, Number(tx.amount), reference)
  }
  // If this was a registration fee, flag the member's KYC application paid too
  if (tx.type === 'registration_fee') {
    await supabaseAdmin.from('kyc_applications')
      .update({ registration_fee_paid: true })
      .eq('created_member_id', tx.member_id).eq('registration_fee_paid', false)
      .then(({ error }) => { if (error) console.log('kyc flag skipped:', error.message) })
  }
  return true
}

serveWithCors(async (req) => {
  const c = handleCors(req)
  if (c) return c
  if (req.method !== 'POST') return error('Method not allowed', 405)

  const session = await requireMember(req)
  if (!session) return error('Unauthorized', 401)

  const blocked = paymentsUnavailable(req, error)
  if (blocked) return blocked

  try {
    const { reference } = await req.json()
    if (!reference) return error('reference is required')

    // Only ever check your own payment
    const { data: tx } = await supabaseAdmin
      .from('transactions')
      .select('reference, status, member_id, related_id, type, amount, batch_id')
      .eq('reference', reference).eq('member_id', session.sub).maybeSingle()

    if (!tx) return error('Payment not found', 404)
    if (tx.status === 'success') return json({ status: 'paid', message: 'Payment confirmed' })

    if (provider() === 'nalo') {
      let lookupRef = reference
      if (provider() === 'nalo') {
        // NaloPay is keyed by its order_id, saved on the transaction at prompt time
        const { data: txRow } = await supabaseAdmin
          .from('transactions').select('paystack_data').eq('reference', reference).maybeSingle()
        const oid = (txRow?.paystack_data as { provider_order_id?: string } | null)?.provider_order_id
        if (oid) lookupRef = oid
      }
      const s = await naloStatus(lookupRef)
      if (!s)        return json({ status: 'pending', message: 'Waiting for confirmation…' })
      if (s.pending) return json({ status: 'pending', message: 'Waiting for you to approve the prompt…' })
      if (!s.settled) {
        await supabaseAdmin.from('transactions').update({ status: 'failed' }).eq('reference', reference)
        return json({ status: 'failed', message: 'The payment was not completed. You can try again.' })
      }

      const due = Number(tx.amount)
      if (s.amount + 0.01 < due) {
        return json({ status: 'pending', message: 'Partial payment received. Contact your admin.' })
      }

      const iSettled = await settleLocally(reference, tx, s.raw)
      if (!iSettled) return json({ status: 'paid', message: 'Payment confirmed. Thank you.' })

      // Personalised receipt — this is the path the member's app actually hits
      const { data: m } = await supabaseAdmin
        .from('members').select('full_name, phone').eq('id', tx.member_id).single()
      if (m) {
        let group = 'your susu'
        let days = 1
        if (tx.batch_id) {
          const { data: batchRows } = await supabaseAdmin
            .from('contributions').select('susu_groups(name)').eq('batch_id', tx.batch_id)
          days = batchRows?.length ?? 1
          group = ((batchRows?.[0]?.susu_groups) as { name?: string } | null)?.name ?? group
        } else if (tx.related_id) {
          const { data: c } = await supabaseAdmin
            .from('contributions').select('susu_groups(name)').eq('id', tx.related_id).single()
          group = (c?.susu_groups as { name?: string } | null)?.name ?? group
        }
        if (lastSpread && (lastSpread.daysCleared > 1 || lastSpread.groups.length > 1 || lastSpread.unallocated > 0.001)) {
          await sendSMS(m.phone, smsTemplates.paymentSpread(
            m.full_name.split(' ')[0], Number(tx.amount).toFixed(2),
            lastSpread.daysCleared, lastSpread.groups.length, lastSpread.unallocated))
        } else {
          await sendSMS(m.phone, smsTemplates.paymentConfirmedDetailed(
            m.full_name.split(' ')[0], Number(tx.amount).toFixed(2), group, days))
        }
        await notifyAdmins(smsTemplates.adminPaymentReceived(
          m.full_name, Number(tx.amount).toFixed(2), group))
      }
      return json({ status: 'paid', message: 'Payment confirmed. Thank you.' })
    }

    return json({ status: 'pending', message: 'Not confirmed yet.' })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
