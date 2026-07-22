import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'

/*
 * Repair: reverse every payment that was force-settled.
 *
 * A removed "force settle" action once marked all pending provider payments
 * as received, so money that never completed was counted as collected. Those
 * transactions carry a marker (paystack_data.reconciled_raw.forced), which is
 * how we find them precisely — nothing else is touched.
 *
 * Each one is put back: the day returns to unpaid, its penalty is restored,
 * and the transaction is marked failed rather than deleted. Safe to re-run;
 * once repaired there is nothing left to find.
 *
 *   POST { dry_run?: boolean }   dry_run lists what would change
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST') return error('Method not allowed', 405)

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  try {
    const body = await req.json().catch(() => ({}))
    const dryRun = body.dry_run === true

    // Successful payment transactions that carry the force marker
    const { data: txns, error: dbErr } = await supabaseAdmin
      .from('transactions')
      .select('id, reference, amount, related_id, batch_id, member_id, paystack_data, created_at')
      .eq('status', 'success')
      .in('type', ['contribution', 'bulk_contribution', 'registration_fee'])
      .limit(2000)
    if (dbErr) return error(dbErr.message, 500)

    const forced = (txns ?? []).filter((t: any) => {
      const p = t.paystack_data as any
      return p?.reconciled_raw?.forced === true || p?.forced === true
    })

    const today = new Date().toISOString().slice(0, 10)
    const details: any[] = []
    let reversed = 0

    for (const tx of forced) {
      // Which days did this transaction mark paid?
      const ids: string[] = []
      if (tx.batch_id) {
        const { data: rows } = await supabaseAdmin
          .from('contributions').select('id').eq('batch_id', tx.batch_id).eq('status', 'paid')
        for (const r of rows ?? []) ids.push(r.id)
      } else if (tx.related_id) {
        ids.push(tx.related_id)
      }

      for (const cid of ids) {
        const { data: c } = await supabaseAdmin
          .from('contributions')
          .select('id, status, amount, due_date, member_id, members!member_id(full_name), susu_groups(name)')
          .eq('id', cid).single()
        if (!c || c.status !== 'paid') continue

        details.push({
          member: (c as any).members?.full_name,
          group: (c as any).susu_groups?.name,
          amount: Number(c.amount),
          due_date: c.due_date,
          reference: tx.reference,
        })

        if (dryRun) continue

        await supabaseAdmin.from('contributions').update({
          status: c.due_date < today ? 'overdue' : 'pending',
          paid_at: null, paystack_ref: null, payment_method: null, amount_paid: 0,
        }).eq('id', cid)

        await supabaseAdmin.from('payment_penalties')
          .update({ is_paid: false, paid_at: null })
          .eq('contribution_id', cid).then(() => {}, () => {})

        reversed++
      }

      if (!dryRun) {
        await supabaseAdmin.from('transactions')
          .update({ status: 'failed', description: 'Reversed — force-settled while still pending at the provider' })
          .eq('id', tx.id)

        await supabaseAdmin.from('audit_log').insert({
          admin_id: admin.sub, admin_name: admin.full_name ?? admin.email,
          action: 'payment.force_settle_reversed', entity_type: 'transaction',
          entity_id: tx.id, entity_label: tx.reference,
          details: { amount: tx.amount, days: ids.length },
        }).then(() => {}, () => {})
      }
    }

    return json({
      dry_run: dryRun,
      force_settled_transactions: forced.length,
      days_reversed: dryRun ? details.length : reversed,
      details,
      message: forced.length === 0
        ? 'Nothing to repair — no force-settled payments remain.'
        : dryRun
          ? `${details.length} day(s) would be put back to unpaid.`
          : `${reversed} day(s) put back to unpaid.`,
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
