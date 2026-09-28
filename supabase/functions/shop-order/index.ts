import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin } from '../_shared/supabase-admin.ts'
import { requestPayment } from '../_shared/nalo.ts'
import { rateLimit, tooManyMessage } from '../_shared/rate-limit.ts'

/**
 * BUYING OUTRIGHT.
 *
 *   POST { items:[{product_id, quantity}], full_name, phone, email?, address?, note?, momo?, network? }
 *
 * ────────────────────────────────────────────────────────────────────────
 * Public — a shop that needs an account before it will take money is a shop
 * that takes less money. The order carries the buyer's name and phone, which
 * is what the collector needs to hand the goods over.
 *
 * ── THE BROWSER DOES NOT SET PRICES ─────────────────────────────────────
 *
 * Only ids and quantities are read from the body. `create_order` looks every
 * price up in `products` and totals it there, so a cart edited in devtools
 * buys nothing cheaply. The amount charged is the total the DATABASE returned,
 * never a number that came from the client.
 *
 * ── AND IT DOES NOT MARK ANYTHING PAID ──────────────────────────────────
 *
 * The order is written `pending_payment` and the transaction `pending`. It
 * becomes paid when NaloPay says so, in payments-verify or nalo-webhook.
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST') return error('Method not allowed', 405, req)

  const gate = await rateLimit(req, 'shop-order', 8, 60)
  if (!gate.allowed) {
    return error(tooManyMessage(gate.retryAfterSeconds, 'attempts from this device'), 429, req)
  }

  try {
    const b = await req.json().catch(() => null)
    if (!b) return error('Expected a JSON body', 400, req)
    if (!Array.isArray(b.items) || b.items.length === 0) {
      return error('Your basket is empty', 400, req)
    }
    if (!b.full_name || !b.phone) {
      return error('Your name and phone number are required', 400, req)
    }

    const norm = (v: unknown) =>
      String(v ?? '').trim().replace(/^0/, '+233').replace(/^\+?233/, '+233')
    const phone = norm(b.phone)

    // Ids and quantities only. Anything else the client sent is discarded here.
    const items = b.items
      .filter((i: { product_id?: string }) => /^[0-9a-f-]{36}$/i.test(String(i?.product_id ?? '')))
      .map((i: { product_id: string; quantity?: number }) => ({
        product_id: i.product_id,
        quantity: Math.max(1, Math.min(Number(i.quantity ?? 1) || 1, 50)),
      }))
    if (items.length === 0) return error('Your basket is empty', 400, req)

    const { data: order, error: oErr } = await supabaseAdmin.rpc('create_order', {
      p_items: items,
      p_full_name: String(b.full_name),
      p_phone: phone,
      p_email: b.email ? String(b.email) : null,
      p_address: b.address ? String(b.address) : null,
      p_note: b.note ? String(b.note).slice(0, 400) : null,
    })
    // "Only 2 of that left", "not on sale" — the database writes the sentence.
    if (oErr) return error(oErr.message, 400, req)

    const total = Number(order.total)
    const ref = `ORD-${String(order.reference).replace('AW-', '')}-${Date.now()}`

    await supabaseAdmin.from('transactions').insert({
      type: 'order', amount: total, reference: ref, status: 'pending',
      related_id: order.order_id,
      description: `Order ${order.reference}`,
    })

    const momo = String(b.momo ?? b.phone ?? '').trim()
    if (!momo) return error('Enter the mobile money number to charge', 400, req)

    const res = await requestPayment({
      payer: momo, amount: total, provider: String(b.network ?? 'MTN'),
      externalref: ref, reference: 'Order payment',
      accountName: String(b.full_name),
    })

    if (res.kind === 'prompted') {
      if (res.providerOrderId) {
        await supabaseAdmin.from('transactions')
          .update({ paystack_data: { provider_order_id: res.providerOrderId } as never })
          .eq('reference', ref)
      }
      return json({
        status: 'prompted', order: order.reference, reference: ref, total,
        message: res.ussd
          ? `Dial ${res.ussd} on ${momo} to approve GHS ${total.toFixed(2)}.`
          : `Approve GHS ${total.toFixed(2)} on ${momo}.`,
      }, 201, req)
    }

    await supabaseAdmin.from('transactions').update({ status: 'failed' }).eq('reference', ref)
    await supabaseAdmin.from('orders').update({ status: 'cancelled' }).eq('id', order.order_id)
    return error('The payment could not be started. Please try again.', 502, req)
  } catch (e) {
    console.error(e)
    return error('We could not place that order. Please try again.', 500, req)
  }
})
