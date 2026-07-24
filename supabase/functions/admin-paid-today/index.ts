import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'

/*
 * A collection day, told as two separate facts — because conflating them is
 * how a report starts lying.
 *
 *   MONEY IN   — payments whose paid_at falls on this date, whatever day they
 *                cover. This is the cash that actually arrived, and the only
 *                figure that can be reconciled against the provider.
 *
 *   COVERAGE   — contributions due on this date and whether they are settled.
 *                A day can be covered by money received earlier (paying ahead,
 *                or an overpayment spilling forward), so coverage must never
 *                be reported as today's takings.
 *
 * The earlier version reported coverage as income: days due today that had
 * been paid on the 20th showed as money collected today, while the provider
 * showed nothing. Now the two are counted and shown separately.
 *
 *   ?date=YYYY-MM-DD   (default: today)
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  try {
    const url = new URL(req.url)
    const now = new Date()
    const todayStr = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
      .toISOString().slice(0, 10)
    const day = url.searchParams.get('date') || todayStr

    const howPaid = (c: any) => (c.paystack_ref ? 'app' : 'manual')
    const shape = (c: any) => ({
      contribution_id: c.id,
      member_id: (c as any).members?.id,
      name: (c as any).members?.full_name ?? '—',
      code: (c as any).members?.member_id,
      group: (c as any).susu_groups?.name ?? 'Susu',
      amount: Number(c.amount),
      due_date: c.due_date,
      paid_at: c.paid_at,
      how: howPaid(c),
      method: c.payment_method || null,
    })

    const SELECT =
      'id, amount, amount_paid, due_date, status, paid_at, payment_method, paystack_ref, ' +
      'member_id, group_id, members!member_id(id, full_name, member_id, phone), susu_groups(name)'

    // ── MONEY IN: paid_at on this date ──────────────────────────
    const { data: receivedRows, error: e1 } = await supabaseAdmin
      .from('contributions').select(SELECT)
      .eq('status', 'paid')
      .gte('paid_at', `${day}T00:00:00Z`)
      .lte('paid_at', `${day}T23:59:59.999Z`)
      .order('paid_at', { ascending: false })
      .limit(3000)
    if (e1) return error(e1.message, 500)

    let inApp = 0, manual = 0
    const received = (receivedRows ?? []).map((c: any) => {
      const r = shape(c)
      if (r.how === 'app') inApp += r.amount; else manual += r.amount
      // Money received today can settle a day due later (paying ahead) or
      // earlier (catching up on arrears) — say which, so it reads honestly.
      return { ...r, covers: r.due_date === day ? 'today' : (r.due_date > day ? 'ahead' : 'arrears') }
    })

    // ── COVERAGE: contributions due on this date ────────────────
    const { data: dueRows, error: e2 } = await supabaseAdmin
      .from('contributions').select(SELECT)
      .eq('due_date', day)
      .limit(5000)
    if (e2) return error(e2.message, 500)

    const covered: any[] = []
    const unpaid: any[] = []
    let coveredEarlier = 0
    for (const c of dueRows ?? []) {
      if (c.status === 'paid') {
        const r = shape(c)
        const paidDay = c.paid_at ? String(c.paid_at).slice(0, 10) : null
        const early = !!paidDay && paidDay !== day
        if (early) coveredEarlier++
        covered.push({ ...r, paid_on_another_day: early, paid_day: paidDay })
      } else {
        unpaid.push({
          ...shape(c),
          part_paid: Number(c.amount_paid ?? 0),
          status: c.status,
        })
      }
    }
    covered.sort((a, b) => (b.paid_at ?? '').localeCompare(a.paid_at ?? ''))
    unpaid.sort((a, b) => a.name.localeCompare(b.name))

    return json({
      day,
      received,                 // money that actually arrived on this date
      covered,                  // days due this date that are settled
      unpaid,                   // days due this date still owing
      summary: {
        // money in
        received_total: Math.round((inApp + manual) * 100) / 100,
        received_in_app: Math.round(inApp * 100) / 100,
        received_manual: Math.round(manual * 100) / 100,
        received_count: received.length,
        // coverage
        expected: (dueRows ?? []).length,
        paid_count: covered.length,
        unpaid_count: unpaid.length,
        covered_earlier: coveredEarlier,
        outstanding: Math.round(unpaid.reduce((s, r) => s + r.amount, 0) * 100) / 100,
      },
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
