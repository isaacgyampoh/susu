import { handleCors, json, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }         from '../_shared/supabase-admin.ts'
import { paymentStatus, parseCallback } from '../_shared/nalo.ts'
import { sendSMS, smsTemplates, notifyAdmins } from '../_shared/africas-talking.ts'
import { applyPaymentToSchedule, claimTransaction } from '../_shared/settle.ts'

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
    console.log('nalo webhook received:', JSON.stringify(body))
    const { externalref, claimsSuccess } = parseCallback(body)
    if (!externalref) {
      console.warn('nalo webhook: no order_id in payload')
      return json({ received: true })
    }
    // NaloPay only calls this webhook when a collection reaches COMPLETED, so
    // the callback itself is authoritative. We still confirm via the status
    // endpoint if we can, but if that lags on PENDING we trust the callback.
    await settle(externalref, claimsSuccess)
    return json({ received: true })
  } catch (e) {
    console.error('nalo webhook:', e)
    return json({ received: true })
  }
})

async function settle(orderId: string, callbackSaysComplete = false) {
  const tx = await paymentStatus(orderId)        // best-effort confirmation
  const settled = tx?.settled || callbackSaysComplete
  if (!settled) { console.warn(`nalo: ${orderId} not settled (status ${tx?.settled}, callback ${callbackSaysComplete})`); return }
  const amount = tx?.amount ?? 0

  // Find the transaction by the provider's order id, matched in the database
  // rather than by scanning pending rows. Scanning was fragile: it only looked
  // at pending transactions and was capped by the default row limit, so when a
  // member paid two groups within a minute the second callback could arrive
  // while the first was mid-settle and match nothing at all — one payment
  // showed, the other silently vanished.
  const { data: matches } = await supabaseAdmin
    .from('transactions')
    .select('id, status, member_id, related_id, type, amount, reference, paystack_data')
    .contains('paystack_data', { provider_order_id: orderId })
    .limit(5)

  let existing = (matches ?? [])[0] ?? null

  // The order id is written just after the prompt is raised, so a very fast
  // callback can beat it. Give it a moment rather than dropping the payment —
  // the sweeper would catch it later, but the member should not wait.
  if (!existing) {
    await new Promise(r => setTimeout(r, 2500))
    const { data: retry } = await supabaseAdmin
      .from('transactions')
      .select('id, status, member_id, related_id, type, amount, reference, paystack_data')
      .contains('paystack_data', { provider_order_id: orderId })
      .limit(5)
    existing = (retry ?? [])[0] ?? null
  }

  if (!existing) { console.warn(`nalo: settled ${orderId} with no local record`); return }
  const ref = existing.reference
  if (existing.status === 'success') return      // already done

  // The paid amount: from the status endpoint if it gave one, else the
  // transaction's recorded amount (the webhook only fires on completion).
  const paidAmount = amount > 0 ? amount : Number(existing.amount ?? 0)

  // Claim before doing anything: the app's polling or the sweeper may have
  // settled this already, and two receipts read as two charges.
  if (!(await claimTransaction(existing.id, { webhook_amount: paidAmount }))) {
    console.log(`nalo: ${orderId} already settled elsewhere`)
    return
  }

  if (existing.type === 'contribution' && existing.related_id) {
    // Spread the payment: overpayments clear later days of the same slot,
    // shortfalls bank as a part payment — identical to every other path.
    await applyPaymentToSchedule(existing.related_id, Number(existing.amount ?? 0), ref)
  }


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
      m.full_name.split(' ')[0], Number(paidAmount).toFixed(2), group, days))
    await notifyAdmins(smsTemplates.adminPaymentReceived(m.full_name, Number(paidAmount).toFixed(2), group))
  }
}
