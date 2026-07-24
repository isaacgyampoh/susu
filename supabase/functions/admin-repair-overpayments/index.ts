import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'
import { applyPaymentToSchedule }  from '../_shared/settle.ts'

/*
 * Repair historical overpayments.
 *
 * Before payments spread across groups, a member who paid GHS 500 against a
 * GHS 55 day had one day settled and the surplus either banked against that
 * one contribution or lost — while their other groups stayed unpaid. This
 * finds those surpluses and applies them the way the system now would:
 * across the member's groups, oldest debt first.
 *
 * How a surplus is found, per successful contribution payment:
 *   surplus = amount actually received  −  what that day cost
 * The "amount received" is the payment transaction's amount (the contribution
 * value, before the service charge). Anything left after covering the day is
 * spread; if the member now owes nothing anywhere it is reported as credit.
 *
 * Read-only preview by default. Pass apply:true to make the changes. Every
 * change is audit-logged. Idempotent: re-running finds nothing new, because
 * the surplus has by then been applied and the days are marked paid.
 *
 *   POST { apply?: boolean, member_id?: string, since?: 'YYYY-MM-DD' }
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST') return error('Method not allowed', 405)

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  try {
    const body = await req.json().catch(() => ({}))
    const doApply  = body.apply === true
    const onlyMember = body.member_id ? String(body.member_id) : null
    const since = body.since ? `${body.since}T00:00:00Z`
                             : new Date(Date.now() - 90 * 864e5).toISOString()

    // Successful contribution payments that could carry a surplus
    let txq = supabaseAdmin
      .from('transactions')
      .select('id, reference, amount, related_id, member_id, paystack_data, created_at')
      .eq('status', 'success')
      .eq('type', 'contribution')
      .not('related_id', 'is', null)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(2000)
    if (onlyMember) txq = txq.eq('member_id', onlyMember)

    const { data: txns, error: txErr } = await txq
    if (txErr) return error(txErr.message, 500)

    const found: any[] = []
    let applied = 0
    let creditTotal = 0

    for (const tx of txns ?? []) {
      // Skip anything already processed by this repair
      if ((tx.paystack_data as any)?.overpay_repaired) continue

      const paid = Number(tx.amount)

      // What did the day this payment was for cost?
      const { data: c } = await supabaseAdmin
        .from('contributions')
        .select('id, amount, penalty_due, member_id, membership_id, ' +
                'members!member_id(full_name), susu_groups(name)')
        .eq('id', tx.related_id).single()
      if (!c) continue

      const dayCost = Number(c.amount) + Number(c.penalty_due ?? 0)
      const surplus = Math.round((paid - dayCost) * 100) / 100
      if (surplus <= 0.001) continue   // not an overpayment

      // Does the member still owe anywhere? (that's the symptom to fix)
      const { data: owing } = await supabaseAdmin
        .from('contributions')
        .select('id, amount, amount_paid, penalty_due, susu_groups(name)')
        .eq('member_id', c.member_id)
        .in('status', ['pending', 'overdue'])
        .limit(400)
      const stillOwes = (owing ?? []).reduce(
        (s: number, r: any) => s + (Number(r.amount) + Number(r.penalty_due ?? 0) - Number(r.amount_paid ?? 0)), 0)

      const row = {
        member: (c as any).members?.full_name,
        member_id: c.member_id,
        started_in: (c as any).susu_groups?.name,
        paid, day_cost: dayCost, surplus,
        currently_owes: Math.round(stillOwes * 100) / 100,
        will_cover: Math.round(Math.min(surplus, stillOwes) * 100) / 100,
        will_credit: Math.round(Math.max(0, surplus - stillOwes) * 100) / 100,
      }
      found.push(row)
      creditTotal += row.will_credit

      if (!doApply) continue

      // Apply the surplus across the member's groups. We start the allocation
      // at the member's oldest unpaid day so it flows outward from there.
      const { data: oldest } = await supabaseAdmin
        .from('contributions')
        .select('id')
        .eq('member_id', c.member_id)
        .in('status', ['pending', 'overdue'])
        .order('due_date', { ascending: true })
        .limit(1)
      if (oldest && oldest.length > 0) {
        await applyPaymentToSchedule(oldest[0].id, surplus, tx.reference, 'member')
      }

      await supabaseAdmin.from('transactions')
        .update({ paystack_data: { ...(tx.paystack_data ?? {}), overpay_repaired: true, surplus } as never })
        .eq('id', tx.id)

      await supabaseAdmin.from('audit_log').insert({
        admin_id: admin.sub, admin_name: admin.full_name ?? admin.email,
        action: 'payment.overpay_spread', entity_type: 'transaction',
        entity_id: tx.id, entity_label: `GHS ${surplus.toFixed(2)} surplus`,
        details: row,
      }).then(() => {}, () => {})

      applied++
    }

    return json({
      applied: doApply,
      overpayments_found: found.length,
      surplus_total: Math.round(found.reduce((s, r) => s + r.surplus, 0) * 100) / 100,
      would_credit_total: Math.round(creditTotal * 100) / 100,
      changed: applied,
      details: found,
      message: found.length === 0
        ? 'No unresolved overpayments found.'
        : doApply
          ? `${applied} overpayment(s) spread across members' groups.`
          : `${found.length} overpayment(s) found. Review, then apply.`,
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
