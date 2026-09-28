import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin } from '../_shared/supabase-admin.ts'
import { requireAdmin } from '../_shared/jwt.ts'

/**
 * OUTRIGHT ORDERS, AS THE SHOP SEES THEM.
 *
 *   GET                       every order, filterable
 *   PATCH ?id=<uuid>          move it along
 *
 * ────────────────────────────────────────────────────────────────────────
 * `status` here is the ORDER's progress — processing, ready, completed. It is
 * not the payment status: that comes from `paid_reference`, set only when the
 * provider confirmed, and nothing on this route can set it. An order marked
 * "paid" by an administrator would be a receipt for money nobody received.
 */
const NEXT = ['processing', 'ready', 'completed', 'cancelled'] as const

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401, req)

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  const ok = id && /^[0-9a-f-]{36}$/i.test(id) ? id : null

  try {
    if (req.method === 'GET') {
      const { data, error: e } = await supabaseAdmin.rpc('get_admin_orders', {
        p_status: url.searchParams.get('status') || null,
        p_search: url.searchParams.get('q') || null,
        p_limit: Math.min(Number(url.searchParams.get('limit') ?? 50), 200),
        p_offset: Math.max(Number(url.searchParams.get('offset') ?? 0), 0),
      })
      if (e) return error(e.message, 502, req)
      return json(data ?? { totals: {}, orders: [] }, 200, req)
    }

    if (req.method === 'PATCH' && ok) {
      const b = await req.json().catch(() => null)
      const next = String(b?.status ?? '')
      if (!NEXT.includes(next as typeof NEXT[number])) {
        return error(`Status must be one of: ${NEXT.join(', ')}`, 400, req)
      }

      const { data: o } = await supabaseAdmin
        .from('orders').select('reference, status, paid_reference').eq('id', ok).single()
      if (!o) return error('Order not found', 404, req)

      const row = o as { reference: string; status: string; paid_reference: string | null }
      // Nothing moves forward on money that never arrived.
      if (!row.paid_reference && next !== 'cancelled') {
        return error(
          `Order ${row.reference} has not been paid, so it cannot be marked ${next}.`, 409, req)
      }

      await supabaseAdmin.from('orders').update({ status: next }).eq('id', ok)
      await supabaseAdmin.from('audit_log').insert({
        admin_id: admin.sub, admin_name: admin.full_name ?? admin.email,
        action: 'order.status_changed', entity_type: 'order', entity_id: ok,
        entity_label: `${row.reference} → ${next}`,
        details: { from: row.status, to: next },
      })
      return json({ message: `Order marked ${next}` }, 200, req)
    }

    return error('Method not allowed', 405, req)
  } catch (e) {
    console.error(e)
    return error('Something went wrong.', 500, req)
  }
})
