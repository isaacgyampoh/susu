import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin } from '../_shared/supabase-admin.ts'
import { requireMember } from '../_shared/jwt.ts'
import { requestPayment } from '../_shared/nalo.ts'
import { rateLimit, tooManyMessage } from '../_shared/rate-limit.ts'

/**
 * PAYING AN INSTALMENT.
 *
 *   POST { purchase_id, amount?, momo?, network? }
 *
 * ────────────────────────────────────────────────────────────────────────
 * ── THE AMOUNT IS CHECKED, NOT TRUSTED ──────────────────────────────────
 *
 * `amount` is optional and defaults to what the schedule actually says is due.
 * When it IS supplied it is bounded: never below a pesewa, never above the
 * remaining balance. A client that posts 0.01 against a GHS 4,000 television
 * pays one pesewa and still owes the rest; a client that posts 99,999 is
 * refused rather than quietly overpaying into a hole.
 *
 * ── THE PURCHASE MUST BE THE CALLER'S ───────────────────────────────────
 *
 * Matched on member AND purchase, from the verified session. Paying into
 * somebody else's purchase is not possible, and neither is discovering that
 * their purchase exists.
 *
 * ── THIS RECORDS AN INTENT, NOT A PAYMENT ───────────────────────────────
 *
 * The transaction is written `pending` with `related_id` pointing at the
 * purchase, and settlement happens later — in payments-verify when the phone
 * asks, or in nalo-webhook when NaloPay says so, whichever arrives first. This
 * endpoint never marks anything successful, because it has not heard from the
 * provider yet and money is not moved by optimism.
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST') return error('Method not allowed', 405, req)

  const session = await requireMember(req)
  if (!session) return error('Unauthorized', 401, req)

  const gate = await rateLimit(req, 'shop-pay', 12, 60)
  if (!gate.allowed) {
    return error(tooManyMessage(gate.retryAfterSeconds, 'payment attempts'), 429, req)
  }

  try {
    const body = await req.json().catch(() => null)
    const purchaseId = String(body?.purchase_id ?? '')
    if (!/^[0-9a-f-]{36}$/i.test(purchaseId)) {
      return error('Which purchase is this for?', 400, req)
    }

    const { data: purchase } = await supabaseAdmin
      .from('purchases')
      .select('id, reference, product_name, status, member_id')
      .eq('id', purchaseId).eq('member_id', session.sub).single()
    // Not theirs and not existing give the same answer, on purpose.
    if (!purchase) return error('Purchase not found', 404, req)

    const p = purchase as { reference: string; product_name: string; status: string }
    if (['cancelled', 'refunded'].includes(p.status)) {
      return error(`This purchase is ${p.status} and cannot take payments.`, 409, req)
    }
    if (p.status === 'fully_paid') {
      return error(`"${p.product_name}" is already paid in full.`, 409, req)
    }

    // What is genuinely outstanding, from the schedule — not from the client.
    const { data: rows } = await supabaseAdmin
      .from('purchase_installments')
      .select('amount, amount_paid, status')
      .eq('purchase_id', purchaseId).neq('status', 'waived')

    const balance = (rows ?? []).reduce(
      (t: number, r: { amount: number; amount_paid: number }) =>
        t + (Number(r.amount) - Number(r.amount_paid)), 0)
    if (balance <= 0.004) return error('There is nothing left to pay.', 409, req)

    const nextDue = (rows ?? [])
      .filter((r: { status: string }) => r.status !== 'paid')
      .reduce((t: number, r: { amount: number; amount_paid: number }) =>
        t === 0 ? Number(r.amount) - Number(r.amount_paid) : t, 0)

    let amount = body?.amount === undefined || body?.amount === null
      ? Math.min(nextDue || balance, balance)
      : Number(body.amount)

    if (!Number.isFinite(amount) || amount < 0.01) {
      return error('Enter an amount of at least GHS 0.01', 400, req)
    }
    if (amount > balance + 0.004) {
      return error(
        `That is more than the GHS ${balance.toFixed(2)} still owing on this purchase.`, 400, req)
    }
    amount = Math.round(amount * 100) / 100

    const { data: member } = await supabaseAdmin
      .from('members').select('full_name, mobile_money_number, mobile_money_provider')
      .eq('id', session.sub).single()
    const m = member as {
      full_name: string; mobile_money_number: string | null; mobile_money_provider: string | null
    } | null

    const momo = String(body?.momo ?? m?.mobile_money_number ?? '').trim()
    if (!momo) return error('No mobile money number. Enter one to pay.', 400, req)
    const network = String(body?.network ?? m?.mobile_money_provider ?? 'MTN')

    const ref = `INS-${purchaseId.slice(0, 8)}-${Date.now()}`

    // The intent, before asking for money, so a confirmation always has a row
    // to land on. `related_id` is how the callback finds the purchase.
    const { error: txErr } = await supabaseAdmin.from('transactions').insert({
      member_id: session.sub, type: 'installment', amount,
      reference: ref, status: 'pending', related_id: purchaseId,
      description: `Instalment for ${p.product_name} (${p.reference})`,
    })
    if (txErr) return error('We could not start that payment. Please try again.', 500, req)

    const res = await requestPayment({
      payer: momo, amount, provider: network,
      externalref: ref, reference: 'Instalment payment',
      accountName: m?.full_name ?? 'Customer',
    })

    if (res.kind === 'prompted') {
      if (res.providerOrderId) {
        await supabaseAdmin.from('transactions')
          .update({ paystack_data: { provider_order_id: res.providerOrderId } as never })
          .eq('reference', ref).eq('member_id', session.sub)
      }
      return json({
        status: 'prompted', reference: ref, amount,
        message: res.ussd
          ? `Dial ${res.ussd} on ${momo} to approve GHS ${amount.toFixed(2)}.`
          : `Approve GHS ${amount.toFixed(2)} on ${momo}.`,
      }, 200, req)
    }

    await supabaseAdmin.from('transactions')
      .update({ status: 'failed' }).eq('reference', ref)
    return error('The payment could not be started. Please try again.', 502, req)
  } catch (e) {
    console.error(e)
    return error('Something went wrong starting that payment.', 500, req)
  }
})
