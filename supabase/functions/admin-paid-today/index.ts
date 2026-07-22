import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'

/*
 * Who paid — reads the CONTRIBUTIONS table directly (the source of truth for
 * "this day is paid"), not the transactions ledger. If a member's SMS says
 * "payment confirmed", their contribution row is marked paid — so it shows
 * here regardless of how the payment settled (online, manual, reconcile).
 *
 * ?range=today|7d|30d|all   groups the paid contributions by member+group.
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  try {
    const url   = new URL(req.url)
    const range = url.searchParams.get('range') ?? 'today'

    const now = new Date()
    let since: string | null = null
    if (range === 'today') since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
    else if (range === '7d') since = new Date(now.getTime() - 7 * 864e5).toISOString()
    else if (range === '30d') since = new Date(now.getTime() - 30 * 864e5).toISOString()

    // Contributions marked paid within the window
    let q = supabaseAdmin
      .from('contributions')
      .select('id, amount, due_date, paid_at, payment_method, member_id, group_id, ' +
              'members!member_id(id, full_name, member_id, phone), susu_groups(name)')
      .eq('status', 'paid')
      .order('paid_at', { ascending: false })
      .limit(2000)
    if (since) q = q.gte('paid_at', since)

    const { data: paid, error: dbErr } = await q
    if (dbErr) return error(dbErr.message, 500)

    // Group by member + group, summing days and amount
    const map = new Map<string, any>()
    let grandTotal = 0
    for (const c of paid ?? []) {
      const m = (c as any).members
      const key = `${c.member_id}:${c.group_id}`
      const amt = Number(c.amount)
      grandTotal += amt
      if (!map.has(key)) {
        map.set(key, {
          member_id: m?.id, name: m?.full_name ?? '—', code: m?.member_id, phone: m?.phone,
          group: (c as any).susu_groups?.name ?? 'Susu',
          days: 0, total: 0, last_paid: c.paid_at,
          method: c.payment_method || 'online',
        })
      }
      const row = map.get(key)
      row.days += 1
      row.total += amt
      if (c.paid_at > row.last_paid) row.last_paid = c.paid_at
    }

    const rows = Array.from(map.values()).sort((a, b) => (b.last_paid ?? '').localeCompare(a.last_paid ?? ''))
    const uniqueMembers = new Set((paid ?? []).map((c: any) => c.member_id)).size

    return json({
      range,
      rows,
      summary: {
        members: uniqueMembers,
        payments: (paid ?? []).length,
        total: Math.round(grandTotal * 100) / 100,
      },
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
