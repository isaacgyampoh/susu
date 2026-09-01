import { handleCors, json, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }         from '../_shared/supabase-admin.ts'
import { paymentStatus, parseCallback } from '../_shared/nalo.ts'
import { sendSMS, smsTemplates, notifyAdmins } from '../_shared/africas-talking.ts'
import { settlePayment } from '../_shared/settle.ts'
import { settleRegistrationFee } from '../_shared/registration-fee.ts'

/**
 * NaloPay payment callback.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The callback carries NO SIGNATURE. There is no way to prove it came from
 * NaloPay, so the payload is a RUMOUR: it may tell us which payment to look
 * at, and nothing more. What settles a payment is NaloPay's own status
 * endpoint, asked by us.
 *
 * That was already the stated design. The implementation then undid it:
 *
 *     const settled = tx?.settled || callbackSaysComplete
 *
 * When the status endpoint was slow, down, or still reporting pending — which
 * the rest of this codebase says is routine — the unauthenticated request body
 * decided. Anyone able to POST a success-shaped payload with a valid order id
 * got free contributions. That is finding F-04, and the `||` is now gone.
 *
 * The rule is now absolute: NO PROVIDER CONFIRMATION, NO SETTLEMENT. A
 * callback we cannot verify costs one wasted status lookup and nothing else.
 * The 10-minute sweeper will retry for 48 hours, so a genuine payment whose
 * status endpoint was merely lagging is not lost — it settles a little later.
 * ────────────────────────────────────────────────────────────────────────
 */
serveWithCors(async (req) => {
  const c = handleCors(req)
  if (c) return c
  if (req.method !== 'POST') return json({ received: true })

  try {
    const body = await req.json().catch(() => ({}))
    const { externalref } = parseCallback(body)

    if (!externalref) {
      console.warn('nalo webhook: no order id in payload')
      return json({ received: true })
    }
    await handleCallback(externalref)
    return json({ received: true })
  } catch (e) {
    // Always 200: a provider that gets an error will retry, and a retry storm
    // helps nobody. The sweeper is the real safety net.
    console.error('nalo webhook:', e)
    return json({ received: true })
  }
})

async function handleCallback(orderId: string) {
  // ── 1. Ask the provider. This, and only this, may settle a payment. ────
  const status = await paymentStatus(orderId)

  if (!status?.settled) {
    console.log(`nalo: ${orderId} not confirmed by the provider — leaving pending for the sweeper`)
    return
  }

  // ── 2. Find our record of it. ─────────────────────────────────────────
  const { data: matches } = await supabaseAdmin
    .from('transactions')
    .select('id, status, member_id, related_id, type, amount, reference, paystack_data, items_count')
    .contains('paystack_data', { provider_order_id: orderId })
    .limit(5)

  let tx = (matches ?? [])[0] ?? null

  // The order id is written just after the prompt is raised, so a very fast
  // callback can beat that write. Give it a moment rather than dropping a
  // real payment on the floor.
  if (!tx) {
    await new Promise(r => setTimeout(r, 2500))
    const { data: retry } = await supabaseAdmin
      .from('transactions')
      .select('id, status, member_id, related_id, type, amount, reference, paystack_data, items_count')
      .contains('paystack_data', { provider_order_id: orderId })
      .limit(5)
    tx = (retry ?? [])[0] ?? null
  }

  if (!tx) {
    console.warn(`nalo: provider confirmed ${orderId} but we have no matching payment`)
    return
  }
  if (tx.status === 'success') return   // already settled; nothing to do

  // ── 3. Settle atomically. ─────────────────────────────────────────────
  // The amount the PROVIDER reports is passed through: the engine applies the
  // lesser of it and the recorded amount, so a short payment cannot
  // over-credit. The old code settled `existing.amount` regardless of what
  // actually arrived.
  // A registration fee is not a contribution and has no obligation to settle
  // against — routing it through the allocation engine would raise.
  if (tx.type === 'registration_fee') {
    try {
      const r = await settleRegistrationFee(tx.reference, status.amount)
      if (!r.alreadyDone) console.log(`nalo: registration fee ${tx.reference} settled`)
    } catch (e) {
      console.error(`nalo: registration fee settlement failed for ${tx.reference}:`, (e as Error).message)
    }
    return
  }

  const scope = (tx.paystack_data as { scope?: string } | null)?.scope === 'slot' ? 'slot' : 'member'

  let result
  try {
    result = await settlePayment(tx.reference, status.amount, scope)
  } catch (e) {
    // A settlement that fails must stay visible and stay pending, so the
    // sweeper retries it. It must never be reported as received.
    console.error(`nalo: settlement failed for ${tx.reference}:`, (e as Error).message)
    return
  }

  if (!result.settled || result.allocations.length === 0) {
    console.log(`nalo: ${tx.reference} produced no allocations`)
  }

  // ── 4. Tell the member. Never before the money is recorded. ───────────
  await notifyMember(tx, status.amount, result.daysCleared, result.groups)
}

async function notifyMember(
  tx: { member_id: string; reference: string; type: string; items_count?: number },
  amount: number,
  daysCleared: number,
  groups: string[],
) {
  const { data: m } = await supabaseAdmin
    .from('members').select('full_name, phone').eq('id', tx.member_id).single()
  if (!m) return

  const first = m.full_name.split(' ')[0]
  const group = groups[0] ?? 'your susu'
  const paid = Number(amount).toFixed(2)

  // A payment spanning several days or groups gets a receipt that says so,
  // rather than a single-line confirmation that hides what it covered.
  if (daysCleared > 1 || groups.length > 1) {
    await sendSMS(m.phone, smsTemplates.paymentSpread(first, paid, daysCleared, groups.length, 0))
  } else {
    await sendSMS(m.phone, smsTemplates.paymentConfirmedDetailed(first, paid, group, Math.max(daysCleared, 1)))
  }
  await notifyAdmins(smsTemplates.adminPaymentReceived(m.full_name, paid, group))
}
