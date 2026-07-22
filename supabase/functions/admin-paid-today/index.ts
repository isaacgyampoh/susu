import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'

/*
 * The day view: who paid, and who has not.
 *
 * Reads the CONTRIBUTIONS table — the source of truth for "this day is paid".
 * If a member's SMS said "payment confirmed", their row is marked paid, so
 * they appear here no matter how the money arrived. No reconciliation needed.
 *
 * Channel is derived, not guessed:
 *   paystack_ref present  -> 'nalopay'  (paid themselves through the app)
 *   payment_method present -> 'manual'  (an admin recorded it: cash/momo/bank)
 *
 * Params:
 *   ?date=YYYY-MM-DD   a single day (default: today)
 *   ?range=7d|30d|all  a window instead of a single day
 *   ?channel=all|nalopay|manual
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  try {
    const url     = new URL(req.url)
    const range   = url.searchParams.get('range')
    const channel = url.searchParams.get('channel') ?? 'all'
    const dateStr = url.searchParams.get('date')

    const now = new Date()
    const todayStr = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
      .toISOString().slice(0, 10)
    const day = dateStr || todayStr

    // Window for "paid at": a single day, or a rolling range
    let from: string | null = null
    let to:   string | null = null
    if (range === '7d')       from = new Date(now.getTime() - 7 * 864e5).toISOString()
    else if (range === '30d') from = new Date(now.getTime() - 30 * 864e5).toISOString()
    else if (range === 'all') from = null
    else { from = `${day}T00:00:00Z`; to = `${day}T23:59:59Z` }

    // ── WHO PAID ─────────────────────────────────────────────
    let q = supabaseAdmin
      .from('contributions')
      .select('id, amount, amount_paid, due_date, paid_at, payment_method, paystack_ref, member_id, group_id, ' +
              'members!member_id(id, full_name, member_id, phone), susu_groups(name)')
      .eq('status', 'paid')
      .order('paid_at', { ascending: false })
      .limit(3000)
    if (from) q = q.gte('paid_at', from)
    if (to)   q = q.lte('paid_at', to)

    const { data: paid, error: dbErr } = await q
    if (dbErr) return error(dbErr.message, 500)

    const chanOf = (c: any) => c.paystack_ref ? 'nalopay' : (c.payment_method ? 'manual' : 'nalopay')

    const map = new Map<string, any>()
    let total = 0, nalopayTotal = 0, manualTotal = 0
    for (const c of paid ?? []) {
      const ch = chanOf(c)
      if (channel !== 'all' && ch !== channel) continue
      const m   = (c as any).members
      const amt = Number(c.amount)
      const key = `${c.member_id}:${c.group_id}:${ch}`
      total += amt
      if (ch === 'nalopay') nalopayTotal += amt; else manualTotal += amt

      if (!map.has(key)) {
        map.set(key, {
          member_id: m?.id, name: m?.full_name ?? '—', code: m?.member_id, phone: m?.phone,
          group: (c as any).susu_groups?.name ?? 'Susu',
          channel: ch,
          method: c.payment_method || null,     // cash / momo / bank when manual
          days: 0, total: 0, last_paid: c.paid_at,
        })
      }
      const row = map.get(key)
      row.days  += 1
      row.total += amt
      if ((c.paid_at ?? '') > (row.last_paid ?? '')) row.last_paid = c.paid_at
    }
    const rows = Array.from(map.values())
      .sort((a, b) => (b.last_paid ?? '').localeCompare(a.last_paid ?? ''))

    // ── WHO HAS NOT PAID (single-day view only) ──────────────
    let unpaid: any[] = []
    if (!range) {
      const { data: owing } = await supabaseAdmin
        .from('contributions')
        .select('id, amount, amount_paid, due_date, status, member_id, group_id, ' +
                'members!member_id(id, full_name, member_id, phone), susu_groups(name)')
        .eq('due_date', day)
        .in('status', ['pending', 'overdue'])
        .limit(3000)

      const um = new Map<string, any>()
      for (const c of owing ?? []) {
        const m = (c as any).members
        const key = `${c.member_id}:${c.group_id}`
        if (!um.has(key)) {
          um.set(key, {
            member_id: m?.id, name: m?.full_name ?? '—', code: m?.member_id, phone: m?.phone,
            group: (c as any).susu_groups?.name ?? 'Susu',
            owed: 0, part_paid: 0, status: c.status,
          })
        }
        const row = um.get(key)
        row.owed      += Number(c.amount)
        row.part_paid += Number(c.amount_paid ?? 0)
        if (c.status === 'overdue') row.status = 'overdue'
      }
      unpaid = Array.from(um.values()).sort((a, b) => a.name.localeCompare(b.name))
    }

    return json({
      day, range: range ?? null, channel,
      rows,
      unpaid,
      summary: {
        members:  new Set(rows.map((r: any) => r.member_id)).size,
        payments: rows.reduce((s: number, r: any) => s + r.days, 0),
        total:    Math.round(total * 100) / 100,
        nalopay:  Math.round(nalopayTotal * 100) / 100,
        manual:   Math.round(manualTotal * 100) / 100,
        unpaid_members: unpaid.length,
        unpaid_total:   Math.round(unpaid.reduce((s: number, r: any) => s + r.owed, 0) * 100) / 100,
      },
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
