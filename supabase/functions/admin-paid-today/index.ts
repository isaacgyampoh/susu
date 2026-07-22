import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'

/*
 * The day's payment roll-call.
 *
 * A day is defined by who was SUPPOSED to pay it — contributions whose
 * due_date is that day — split into those who have paid and those who have
 * not. That is the only honest way to read a collection day.
 *
 * Deliberately NOT keyed on paid_at: recording ten past days for a member
 * this morning stamps all ten as "paid now", which made today look like it
 * collected money it never did. Each contribution belongs to its own day.
 *
 * Straight from our own database. No provider calls, no reconciliation.
 * A contribution counts as collected only when status = 'paid'; pending and
 * overdue are never mixed in.
 *
 *   ?date=YYYY-MM-DD   the collection day (default: today)
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

    // Everything due on this day, whatever its state
    const { data: rows, error: dbErr } = await supabaseAdmin
      .from('contributions')
      .select('id, amount, amount_paid, due_date, status, paid_at, payment_method, paystack_ref, ' +
              'member_id, group_id, members!member_id(id, full_name, member_id, phone), susu_groups(name)')
      .eq('due_date', day)
      .order('paid_at', { ascending: false })
      .limit(5000)
    if (dbErr) return error(dbErr.message, 500)

    // How the money arrived: an app payment carries a provider reference,
    // an admin-recorded one carries the method it was collected by.
    const howPaid = (c: any) =>
      c.paystack_ref ? 'app' : (c.payment_method ? 'admin' : 'admin')

    const paid: any[] = []
    const unpaid: any[] = []
    let collected = 0, collectedApp = 0, collectedRecorded = 0

    for (const c of rows ?? []) {
      const m = (c as any).members
      const base = {
        contribution_id: c.id,
        member_id: m?.id,
        name: m?.full_name ?? '—',
        code: m?.member_id,
        phone: m?.phone,
        group: (c as any).susu_groups?.name ?? 'Susu',
        amount: Number(c.amount),
      }

      if (c.status === 'paid') {
        const how = howPaid(c)
        collected += Number(c.amount)
        if (how === 'app') collectedApp += Number(c.amount)
        else collectedRecorded += Number(c.amount)
        paid.push({
          ...base,
          how,
          method: c.payment_method || null,
          paid_at: c.paid_at,
          late: c.paid_at ? c.paid_at.slice(0, 10) > day : false,
        })
      } else {
        unpaid.push({
          ...base,
          part_paid: Number(c.amount_paid ?? 0),
          status: c.status,                       // pending | overdue
        })
      }
    }

    paid.sort((a, b) => (b.paid_at ?? '').localeCompare(a.paid_at ?? ''))
    unpaid.sort((a, b) => a.name.localeCompare(b.name))

    return json({
      day,
      paid,
      unpaid,
      summary: {
        expected:   (rows ?? []).length,
        paid_count: paid.length,
        unpaid_count: unpaid.length,
        collected:  Math.round(collected * 100) / 100,
        collected_app:      Math.round(collectedApp * 100) / 100,
        collected_recorded: Math.round(collectedRecorded * 100) / 100,
        outstanding: Math.round(unpaid.reduce((s, r) => s + r.amount, 0) * 100) / 100,
      },
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
