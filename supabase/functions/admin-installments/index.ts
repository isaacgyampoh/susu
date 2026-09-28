import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin } from '../_shared/supabase-admin.ts'
import { requireAdmin } from '../_shared/jwt.ts'
import { sendSMS, smsTemplates } from '../_shared/africas-talking.ts'

/**
 * INSTALMENTS, AS THE COLLECTOR RUNS THEM.
 *
 *   GET                          overview + pending requests
 *   GET ?requests=1&status=      the request queue
 *   POST ?agreement=1            create an agreement (from a request, or a walk-in)
 *   POST ?payment=1              record a payment taken at the shop
 *   PATCH ?request=<uuid>        decline or note a request
 *
 * ────────────────────────────────────────────────────────────────────────
 * ── WHAT AN ADMIN MAY AND MAY NOT DO ────────────────────────────────────
 *
 * She may agree terms, record money that arrived, and move fulfilment. She may
 * not edit a balance, retype a total, or mark an instalment paid without money
 * behind it. Every figure moves because a payment was recorded, and every
 * recorded payment leaves a transaction, an allocation and an audit row.
 *
 * That is not caution for its own sake: a balance that can be typed over is a
 * balance nobody can defend when a customer disputes it six months later.
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401, req)

  const url = new URL(req.url)
  const uuid = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null)

  const audit = (action: string, label: string, id: string, details: unknown) =>
    supabaseAdmin.from('audit_log').insert({
      admin_id: admin.sub, admin_name: admin.full_name ?? admin.email,
      action, entity_type: 'installment', entity_id: id, entity_label: label,
      details: details as Record<string, unknown>,
    })

  try {
    // ── The queue ──
    if (req.method === 'GET' && url.searchParams.get('requests') === '1') {
      const { data, error: e } = await supabaseAdmin.rpc('get_installment_requests', {
        p_status: url.searchParams.get('status') || null,
      })
      if (e) return error(e.message, 502, req)
      return json({ requests: data ?? [] }, 200, req)
    }

    // ── Overview ──
    if (req.method === 'GET') {
      const [{ data: overview }, { data: requests }] = await Promise.all([
        supabaseAdmin.rpc('get_installment_overview'),
        supabaseAdmin.rpc('get_installment_requests', { p_status: 'pending' }),
      ])
      return json({ overview: overview ?? null, pending: requests ?? [] }, 200, req)
    }

    // ── Create an agreement ──
    if (req.method === 'POST' && url.searchParams.get('agreement') === '1') {
      const b = await req.json().catch(() => null)
      if (!b?.full_name || !b?.phone) return error('Name and phone are required', 400, req)
      if (!uuid(b.product_id ?? null)) return error('Choose a product', 400, req)

      const norm = String(b.phone).trim().replace(/^0/, '+233').replace(/^\+?233/, '+233')

      const { data, error: e } = await supabaseAdmin.rpc('create_installment_agreement', {
        p_admin_id:      admin.sub,
        p_full_name:     String(b.full_name),
        p_phone:         norm,
        p_product_id:    String(b.product_id),
        p_total_payable: Number(b.total_payable),
        p_deposit:       Number(b.deposit ?? 0),
        p_duration:      Number(b.duration),
        p_frequency:     b.frequency ?? 'monthly',
        p_plan_id:       uuid(b.plan_id ?? null),
        p_plan_name:     b.plan_name ? String(b.plan_name) : null,
        p_start_date:    b.start_date ?? new Date().toISOString().slice(0, 10),
        p_request_id:    uuid(b.request_id ?? null),
        p_note:          b.note ? String(b.note).slice(0, 500) : null,
      })
      // The database raises the sentence the collector should read.
      if (e) return error(e.message, 400, req)

      await audit('installment.agreement_created',
        `${data.customer} · ${data.product}`, String(data.purchase_id),
        { total: b.total_payable, deposit: b.deposit, duration: b.duration,
          from_request: b.request_id ?? null })

      try {
        await sendSMS(norm, smsTemplates.purchaseStarted(
          String(b.full_name).split(' ')[0], String(data.product),
          Number(data.total).toFixed(2),
          (Number(b.total_payable) - Number(b.deposit ?? 0)) > 0
            ? ((Number(b.total_payable) - Number(b.deposit ?? 0)) / Number(b.duration)).toFixed(2)
            : '0.00',
          String(b.start_date ?? new Date().toISOString().slice(0, 10))))
      } catch (err) {
        console.error('agreement SMS failed (non-fatal):', (err as Error).message)
      }

      return json({ agreement: data }, 201, req)
    }

    // ── Record money taken at the shop ──
    if (req.method === 'POST' && url.searchParams.get('payment') === '1') {
      const b = await req.json().catch(() => null)
      const purchaseId = uuid(b?.purchase_id ?? null)
      if (!purchaseId) return error('Which purchase is this for?', 400, req)

      const { data, error: e } = await supabaseAdmin.rpc('record_manual_payment', {
        p_purchase_id: purchaseId,
        p_amount:      Number(b.amount),
        p_method:      String(b.method ?? 'cash'),
        p_admin_id:    admin.sub,
        p_reference:   b.reference ? String(b.reference) : null,
        p_paid_on:     b.paid_on ?? new Date().toISOString().slice(0, 10),
        p_note:        b.note ? String(b.note).slice(0, 300) : null,
      })
      if (e) return error(e.message, 400, req)

      await audit('installment.payment_recorded',
        `GHS ${Number(b.amount).toFixed(2)} · ${b.method}`, purchaseId,
        { amount: b.amount, method: b.method, reference: b.reference ?? null,
          paid_on: b.paid_on ?? null, result: data })

      // The customer hears that it landed. Their only window into this is the
      // text, since they have no portal by design.
      try {
        const { data: p } = await supabaseAdmin
          .from('purchases')
          .select('product_name, members!member_id(full_name, phone)')
          .eq('id', purchaseId).single()
        const row = p as unknown as {
          product_name: string; members: { full_name: string; phone: string } | null }
        if (row?.members?.phone && !data.duplicate) {
          const first = row.members.full_name.split(' ')[0]
          await sendSMS(row.members.phone, data.fully_paid
            ? smsTemplates.purchaseComplete(first, row.product_name)
            : smsTemplates.installmentReceived(first, Number(b.amount).toFixed(2),
                row.product_name, Number(data.balance ?? 0).toFixed(2)))
        }
      } catch (err) {
        console.error('payment SMS failed (non-fatal):', (err as Error).message)
      }

      return json({ payment: data }, 201, req)
    }

    // ── Decline or annotate a request ──
    if (req.method === 'PATCH' && uuid(url.searchParams.get('request'))) {
      const id = uuid(url.searchParams.get('request'))!
      const b = await req.json().catch(() => null)
      const next = String(b?.status ?? '')
      if (!['declined', 'cancelled', 'pending'].includes(next)) {
        return error('Status must be declined, cancelled or pending', 400, req)
      }
      const { error: e } = await supabaseAdmin.from('installment_requests')
        .update({ status: next, admin_note: b?.note ? String(b.note).slice(0, 500) : null,
                  decided_by: admin.sub, decided_at: new Date().toISOString() })
        .eq('id', id)
      if (e) return error(e.message, 400, req)

      await audit('installment.request_decided', next, id, { note: b?.note ?? null })
      return json({ message: `Request marked ${next}` }, 200, req)
    }

    return error('Method not allowed', 405, req)
  } catch (e) {
    console.error(e)
    return error('Something went wrong.', 500, req)
  }
})
