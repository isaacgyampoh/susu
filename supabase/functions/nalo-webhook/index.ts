import { handleCors, json, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }         from '../_shared/supabase-admin.ts'
import { paymentStatus, parseCallback } from '../_shared/nalo.ts'
import { sendSMS, smsTemplates, notifyAdmins } from '../_shared/africas-talking.ts'

/**
 * Nalo payment callback.
 *
 * Like Moolre, Nalo's callback carries no signature we can verify, so the
 * payload is a RUMOUR: it tells us which order to look at and nothing more.
 * What settles a contribution is Nalo's own status endpoint, asked by us.
 * A forged callback costs one wasted status lookup and nothing else.
 */
serveWithCors(async (req) => {
  const c = handleCors(req)
  if (c) return c
  if (req.method !== 'POST') return json({ received: true })

  try {
    const body = await req.json().catch(() => ({}))
    const { externalref } = parseCallback(body)
    if (!externalref) {
      console.warn('nalo webhook: no order_id in payload')
      return json({ received: true })
    }
    await settle(externalref)
    return json({ received: true })
  } catch (e) {
    console.error('nalo webhook:', e)
    return json({ received: true })   // always 200 — we poll anyway
  }
})

async function settle(orderId: string) {
  const tx = await paymentStatus(orderId)        // the source of truth (by order_id)
  if (!tx) { console.warn(`nalo: no status for ${orderId}`); return }
  if (!tx.settled) return                        // pending or failed: leave alone

  // The transaction was stored under OUR reference with NaloPay's order_id in
  // paystack_data — find it by that order_id.
  const { data: matches } = await supabaseAdmin
    .from('transactions')
    .select('id, status, member_id, related_id, type, amount, reference, paystack_data')
    .eq('status', 'pending')
  const existing = (matches ?? []).find((t: any) =>
    (t.paystack_data as { provider_order_id?: string } | null)?.provider_order_id === orderId)

  if (!existing) { console.warn(`nalo: settled ${orderId} with no local record`); return }
  const ref = existing.reference
  if (existing.status === 'success') return      // already done

  // Refuse to clear a debt the payment does not cover
  if (existing.type === 'contribution' && existing.related_id) {
    const { data: owed } = await supabaseAdmin
      .from('contributions').select('amount, penalty_due').eq('id', existing.related_id).single()
    const due = Number(owed?.amount ?? 0) + Number(owed?.penalty_due ?? 0)
    if (owed && tx.amount + 0.01 < due) {
      console.warn(`nalo: short payment ${tx.amount} < ${due} on ${ref}`)
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
    // Personalise: name, group, and how many days this covered
    let group = 'your susu'
    let days = 1
    if (existing.type === 'contribution' && existing.related_id) {
      const { data: c } = await supabaseAdmin
        .from('contributions').select('susu_groups(name)').eq('id', existing.related_id).single()
      group = (c?.susu_groups as { name?: string } | null)?.name ?? group
    }
    if (existing.type === 'bulk_contribution' || (existing as any).items_count) {
      days = Number((existing as any).items_count ?? 1)
    }
    await sendSMS(m.phone, smsTemplates.paymentConfirmedDetailed(
      m.full_name.split(' ')[0], tx.amount.toFixed(2), group, days))
    await notifyAdmins(smsTemplates.adminPaymentReceived(m.full_name, tx.amount.toFixed(2), group))
  }
}
