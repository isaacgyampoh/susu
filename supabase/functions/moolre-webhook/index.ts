import { handleCors, json, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }         from '../_shared/supabase-admin.ts'
import { paymentStatus }         from '../_shared/moolre.ts'
import { sendSMS, smsTemplates, notifyAdmins } from '../_shared/africas-talking.ts'

/**
 * Moolre callback.
 *
 * Moolre documents no signature on this callback — unlike Paystack, which signs
 * with HMAC-SHA512. So anyone who learns this URL can POST "payment successful"
 * at it. The payload is therefore treated as a RUMOUR, never as proof: it tells
 * us which reference to look at, and nothing more. What actually settles a
 * contribution is Moolre's own status endpoint, asked by us, over our own
 * authenticated connection.
 *
 * That also means this endpoint is safe to leave open: a forged callback causes
 * one wasted status lookup and nothing else.
 */
serveWithCors(async (req) => {
  const c = handleCors(req)
  if (c) return c
  if (req.method !== 'POST') return json({ received: true })

  try {
    const body = await req.json().catch(() => ({}))
    const d = (body?.data ?? {}) as Record<string, unknown>

    // The only thing we take from the payload: which payment to go and check.
    const ref = String(d.externalref ?? body?.externalref ?? '')
    if (!ref) {
      console.warn('moolre webhook: no externalref in payload')
      return json({ received: true })
    }

    await settle(ref)
    return json({ received: true })
  } catch (e) {
    // Always 200 — a retry storm helps nobody, and we poll anyway.
    console.error('moolre webhook:', e)
    return json({ received: true })
  }
})

/** Confirm with Moolre, then settle. Exported shape kept simple on purpose. */
async function settle(ref: string) {
  const tx = await paymentStatus(ref)          // <- the source of truth
  if (!tx) { console.warn(`moolre: no status for ${ref}`); return }
  if (!tx.settled) return                       // pending or failed: leave it alone

  const { data: existing } = await supabaseAdmin
    .from('transactions').select('id, status, member_id, related_id, type, amount')
    .eq('reference', ref).maybeSingle()

  if (!existing) { console.warn(`moolre: settled ${ref} with no local record`); return }
  if (existing.status === 'success') return     // already done

  // Moolre says what was actually paid. Refuse to clear a debt it does not cover.
  if (existing.type === 'contribution' && existing.related_id) {
    const { data: owed } = await supabaseAdmin
      .from('contributions').select('amount, penalty_due').eq('id', existing.related_id).single()
    const due = Number(owed?.amount ?? 0) + Number(owed?.penalty_due ?? 0)
    if (owed && tx.amount + 0.01 < due) {
      console.warn(`moolre: short payment ${tx.amount} < ${due} on ${ref}`)
      return
    }

    await supabaseAdmin.from('contributions')
      .update({ status: 'paid', paid_at: new Date().toISOString(), paystack_ref: ref })
      .eq('id', existing.related_id)

    await supabaseAdmin.from('payment_penalties')
      .update({ is_paid: true, paid_at: new Date().toISOString() })
      .eq('contribution_id', existing.related_id)
  }

  await supabaseAdmin.from('transactions')
    .update({ status: 'success', paystack_data: tx.raw as never })
    .eq('reference', ref)

  const { data: m } = await supabaseAdmin
    .from('members').select('full_name, phone').eq('id', existing.member_id).single()
  if (m) {
    await sendSMS(m.phone, smsTemplates.paymentConfirmed(m.full_name, tx.amount.toFixed(2), tx.transactionid || ref))
    await notifyAdmins(smsTemplates.adminPaymentReceived(m.full_name, Number(tx.amount).toFixed(2), 'their susu'))
  }
}
