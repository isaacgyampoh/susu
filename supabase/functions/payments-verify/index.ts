import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }         from '../_shared/supabase-admin.ts'
import { requireMember }         from '../_shared/jwt.ts'
import { paymentStatus as naloStatus }   from '../_shared/nalo.ts'
import { provider, paymentsUnavailable } from '../_shared/mode.ts'
import { sendSMS, smsTemplates, notifyAdmins } from '../_shared/africas-talking.ts'
import { settlePayment } from '../_shared/settle.ts'
import { settleRegistrationFee } from '../_shared/registration-fee.ts'

/**
 * The member's app polls this after approving a prompt.
 *
 * With no trustworthy webhook, this is not a convenience — for many payments it
 * is how settlement happens at all. The phone asks "did it land?", we ask
 * NaloPay, and NaloPay's answer decides.
 *
 * Two things changed in Phase 04:
 *
 *   1. THE BATCH BRANCH IS GONE. Paying ahead used to take a completely
 *      separate path — a blanket `UPDATE … WHERE batch_id = …` that wrote no
 *      allocation rows, never set `amount_paid`, and touched no credit. It was
 *      one of five settlement implementations. Every payment, single or bulk,
 *      now goes through the one canonical engine.
 *
 *   2. THE MODULE-SCOPE `lastSpread` IS GONE. It held the previous
 *      settlement's result at module level, and Deno reuses isolates between
 *      requests — so two members verifying at the same moment shared it, and
 *      one member's SMS receipt could carry another's figures. It is now a
 *      local.
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST') return error('Method not allowed', 405)

  const session = await requireMember(req)
  if (!session) return error('Unauthorized', 401)

  const blocked = paymentsUnavailable(req, error)
  if (blocked) return blocked

  try {
    const { reference } = await req.json()
    if (!reference) return error('reference is required')

    // Scoped to the caller: a member may only ever verify their own payment.
    const { data: tx } = await supabaseAdmin
      .from('transactions')
      .select('reference, status, member_id, related_id, type, amount, batch_id, paystack_data, items_count')
      .eq('reference', reference).eq('member_id', session.sub).maybeSingle()

    if (!tx) return error('Payment not found', 404)
    if (tx.status === 'success') return json({ status: 'paid', message: 'Payment confirmed' })
    if (tx.status === 'failed')  return json({ status: 'failed', message: 'This payment did not complete. You can try again.' })

    if (provider() !== 'nalo') return json({ status: 'pending', message: 'Not confirmed yet.' })

    // NaloPay is keyed by ITS order id, saved on the transaction at prompt time.
    const oid = (tx.paystack_data as { provider_order_id?: string } | null)?.provider_order_id
    const s = await naloStatus(oid ?? reference)

    if (!s)        return json({ status: 'pending', message: 'Waiting for confirmation…' })
    if (s.pending) return json({ status: 'pending', message: 'Waiting for you to approve the prompt…' })

    if (!s.settled) {
      await supabaseAdmin.from('transactions').update({ status: 'failed' }).eq('reference', reference)
      return json({ status: 'failed', message: 'The payment was not completed. You can try again.' })
    }

    // A short payment is not settled here. Crediting the full requested amount
    // when less arrived would create money.
    if (s.amount + 0.01 < Number(tx.amount)) {
      return json({
        status: 'pending',
        message: `We received GHS ${s.amount.toFixed(2)} of GHS ${Number(tx.amount).toFixed(2)}. Contact your admin.`,
      })
    }

    // A registration fee buys a place in a group; it settles no obligation.
    if (tx.type === 'registration_fee') {
      try {
        await settleRegistrationFee(reference, s.amount)
        return json({ status: 'paid', message: 'Registration fee received. Thank you.' })
      } catch (e) {
        console.error('registration fee settlement failed:', (e as Error).message)
        return json({ status: 'pending', message: 'Your payment arrived but is still being recorded.' })
      }
    }

    // ── Settle. Atomic, locked, idempotent — and the ONLY path. ─────────
    const scope = (tx.paystack_data as { scope?: string } | null)?.scope === 'slot' ? 'slot' : 'member'

    let result
    try {
      result = await settlePayment(reference, s.amount, scope)
    } catch (e) {
      console.error('settlement failed:', (e as Error).message)
      return json({
        status: 'pending',
        message: 'Your payment arrived but is still being recorded. It will appear shortly.',
      })
    }

    // If a concurrent caller settled it first, `settle_payment` returns that
    // settlement's allocations rather than doing anything twice.
    if (result.allocations.length === 0) {
      return json({ status: 'paid', message: 'Payment confirmed. Thank you.' })
    }

    await sendReceipt(tx.member_id, Number(tx.amount), result.daysCleared, result.groups)

    return json({
      status: 'paid',
      message: 'Payment confirmed. Thank you.',
      // The member is told what their money covered, not just that it worked.
      covered: result.allocations.map(a => ({
        group: a.group_name, due_date: a.due_date, amount: a.amount, kind: a.kind,
      })),
      days_cleared: result.daysCleared,
      credit_added: result.creditAdded,
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})

async function sendReceipt(memberId: string, amount: number, days: number, groups: string[]) {
  const { data: m } = await supabaseAdmin
    .from('members').select('full_name, phone').eq('id', memberId).single()
  if (!m) return
  const first = m.full_name.split(' ')[0]
  const paid = amount.toFixed(2)
  const group = groups[0] ?? 'your susu'

  if (days > 1 || groups.length > 1) {
    await sendSMS(m.phone, smsTemplates.paymentSpread(first, paid, days, groups.length, 0))
  } else {
    await sendSMS(m.phone, smsTemplates.paymentConfirmedDetailed(first, paid, group, Math.max(days, 1)))
  }
  await notifyAdmins(smsTemplates.adminPaymentReceived(m.full_name, paid, group))
}
