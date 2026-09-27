import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin } from '../_shared/supabase-admin.ts'
import { requireAdmin } from '../_shared/jwt.ts'

/**
 * THE SHOP, AS THE OPERATOR SEES IT.
 *
 *   GET                              every purchase, filterable
 *   GET ?id=<uuid>                   one purchase in full
 *   PATCH ?id=<uuid> { fulfilment_status, note }
 *
 * ────────────────────────────────────────────────────────────────────────
 * ── WHAT AN ADMIN MAY AND MAY NOT CHANGE ────────────────────────────────
 *
 * Fulfilment only. There is deliberately no route here that edits a balance,
 * marks an instalment paid, or alters a total. Money moves when the payment
 * provider confirms it and never because somebody typed a number into a
 * console — the same rule that governs the susu side of this system.
 *
 * A wrong payment is corrected by reversal, which leaves both the original and
 * the correction in the record. Editing the figure leaves neither.
 *
 * Every fulfilment change appends to `purchase_fulfilments` rather than
 * overwriting a status, because "who released this, and when" is asked months
 * later and a single mutable column cannot answer it.
 */
const ALLOWED = ['ready', 'released', 'delivered', 'collected', 'returned'] as const

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401, req)

  const url = new URL(req.url)
  const raw = url.searchParams.get('id')
  const id  = raw && /^[0-9a-f-]{36}$/i.test(raw) ? raw : null

  try {
    if (req.method === 'GET' && id) {
      const { data: p } = await supabaseAdmin
        .from('purchases').select('member_id').eq('id', id).single()
      if (!p) return error('Purchase not found', 404, req)

      // Reuses the customer's own detail read, with that customer's id — one
      // definition of "this purchase in full", so the two views cannot drift.
      const { data, error: e } = await supabaseAdmin.rpc('get_purchase_detail', {
        p_member_id: (p as { member_id: string }).member_id, p_purchase_id: id,
      })
      if (e) return error(e.message, 502, req)
      return json(data, 200, req)
    }

    if (req.method === 'GET') {
      const { data, error: e } = await supabaseAdmin.rpc('get_admin_purchases', {
        p_status: url.searchParams.get('status') || null,
        p_search: url.searchParams.get('q') || null,
        p_limit:  Math.min(Number(url.searchParams.get('limit') ?? 50), 200),
        p_offset: Math.max(Number(url.searchParams.get('offset') ?? 0), 0),
      })
      if (e) return error(e.message, 502, req)
      return json(data ?? { totals: {}, purchases: [] }, 200, req)
    }

    if (req.method === 'PATCH' && id) {
      const body = await req.json().catch(() => null)
      const next = String(body?.fulfilment_status ?? '')
      if (!ALLOWED.includes(next as typeof ALLOWED[number])) {
        return error(`Fulfilment status must be one of: ${ALLOWED.join(', ')}`, 400, req)
      }

      const { data: purchase } = await supabaseAdmin
        .from('purchases').select('id, reference, status, product_name, member_id')
        .eq('id', id).single()
      if (!purchase) return error('Purchase not found', 404, req)

      // Releasing goods that are not paid for is a decision, not a click.
      const p = purchase as { status: string; reference: string; product_name: string }
      if (p.status !== 'fully_paid' && next !== 'returned') {
        return error(
          `"${p.product_name}" is not fully paid yet, so it cannot be marked ${next}. ` +
          `If goods are genuinely being released early, record that against the ` +
          `purchase as a note first.`, 409, req)
      }

      await supabaseAdmin.from('purchases')
        .update({ fulfilment_status: next }).eq('id', id)

      await supabaseAdmin.from('purchase_fulfilments').insert({
        purchase_id: id, status: next,
        note: body?.note ? String(body.note).slice(0, 500) : null,
        admin_id: admin.sub, admin_name: admin.full_name ?? admin.email,
      })

      await supabaseAdmin.from('audit_log').insert({
        admin_id: admin.sub, admin_name: admin.full_name ?? admin.email,
        action: 'purchase.fulfilment_changed', entity_type: 'purchase', entity_id: id,
        entity_label: `${p.reference} · ${p.product_name} → ${next}`,
        details: { to: next, note: body?.note ?? null },
      })

      return json({ message: `Marked ${next}` }, 200, req)
    }

    return error('Method not allowed', 405, req)
  } catch (e) {
    console.error(e)
    return error('Something went wrong.', 500, req)
  }
})
