import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'

/*
 * Admin transactions feed — every payment that moved, so the operator can see
 * money received without opening NaloPay. Supports filtering by channel
 * (online vs manual), status, and a date window, and returns period totals so
 * the online figure can be reconciled against NaloPay's own report.
 *
 * Query params:
 *   status   = success | pending | failed | all   (default success)
 *   channel  = online | manual | all              (default all)
 *   range    = today | 7d | 30d | all             (default today)
 *   page     = 1-based                            (default 1, size 50)
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  try {
    const url     = new URL(req.url)
    const status  = url.searchParams.get('status')  ?? 'success'
    const channel = url.searchParams.get('channel') ?? 'all'
    const range   = url.searchParams.get('range')   ?? 'today'
    const page    = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
    const size    = 50

    const now = new Date()
    let since: string | null = null
    if (range === 'today') {
      since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
    } else if (range === '7d') {
      since = new Date(now.getTime() - 7 * 864e5).toISOString()
    } else if (range === '30d') {
      since = new Date(now.getTime() - 30 * 864e5).toISOString()
    }

    let q = supabaseAdmin
      .from('transactions')
      .select('id, amount, type, status, reference, description, created_at, paystack_data, members!member_id(id, full_name, member_id, phone)', { count: 'exact' })
      .in('type', ['contribution', 'bulk_contribution', 'registration_fee'])
      .order('created_at', { ascending: false })

    if (status !== 'all') q = q.eq('status', status)
    if (since) q = q.gte('created_at', since)

    const { data, count, error: dbErr } = await q.range((page - 1) * size, page * size - 1)
    if (dbErr) return error(dbErr.message, 500)

    // Tag each row's channel: online payments carry a NaloPay order_id
    const rows = (data ?? []).map((t: any) => {
      const online = !!(t.paystack_data && t.paystack_data.provider_order_id)
      return {
        id: t.id, amount: Number(t.amount ?? 0), type: t.type, status: t.status,
        reference: t.reference, description: t.description, created_at: t.created_at,
        channel: online ? 'online' : 'manual',
        order_id: online ? t.paystack_data.provider_order_id : null,
        member: t.members ? { id: t.members.id, name: t.members.full_name, member_id: t.members.member_id, phone: t.members.phone } : null,
      }
    })
    const filtered = channel === 'all' ? rows : rows.filter((r: any) => r.channel === channel)

    // Period totals (across the whole range, success only) for the header cards
    let totalsQ = supabaseAdmin
      .from('transactions')
      .select('amount, paystack_data')
      .eq('status', 'success')
      .in('type', ['contribution', 'bulk_contribution', 'registration_fee'])
    if (since) totalsQ = totalsQ.gte('created_at', since)
    const { data: totalsData } = await totalsQ

    let onlineTotal = 0, manualTotal = 0, onlineCount = 0, manualCount = 0
    for (const t of totalsData ?? []) {
      const online = !!(t.paystack_data && (t.paystack_data as any).provider_order_id)
      const a = Number(t.amount ?? 0)
      if (online) { onlineTotal += a; onlineCount++ } else { manualTotal += a; manualCount++ }
    }

    return json({
      transactions: filtered,
      page, has_more: (count ?? 0) > page * size, total: count ?? 0,
      totals: {
        online: { total: Math.round(onlineTotal * 100) / 100, count: onlineCount },
        manual: { total: Math.round(manualTotal * 100) / 100, count: manualCount },
        all:    { total: Math.round((onlineTotal + manualTotal) * 100) / 100, count: onlineCount + manualCount },
        range,
      },
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
