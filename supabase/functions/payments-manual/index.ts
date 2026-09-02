import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'
import { sendSMS, smsTemplates, notifyAdmins } from '../_shared/africas-talking.ts'

/*
 * Manual payment collection — for money received outside any gateway:
 * cash in hand, MoMo sent straight to the operator's number, bank transfer.
 *
 * POST { contribution_ids: string[], method: 'cash'|'momo'|'bank', note?, no_sms? }
 *
 * Marks each selected pending/overdue contribution as paid, stamps how it
 * was paid, writes one audit transaction per member+group batch, and sends
 * the member an SMS receipt (unless no_sms is set).
 *
 * Already-paid rows are skipped, never double-charged: re-submitting the
 * same selection is harmless.
 */

const METHODS = ['cash', 'momo', 'bank'] as const
const label = (m: string) => m === 'momo' ? 'Mobile Money' : m === 'bank' ? 'Bank transfer' : 'Cash'

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST') return error('Method not allowed', 405)

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  try {
    const body = await req.json()
    const ids: string[] = [...new Set((Array.isArray(body.contribution_ids) ? body.contribution_ids : []).filter(Boolean))]
    const method = String(body.method ?? 'cash')
    const note   = body.note ? String(body.note).slice(0, 300) : null

    if (ids.length === 0) return error('Select at least one contribution to mark as paid')
    if (!METHODS.includes(method as any)) return error(`method must be one of: ${METHODS.join(', ')}`)

    // ── PARTIAL payment: an instalment toward ONE contribution ──
    if (body.partial_amount != null && ids.length === 1) {
      const amt = Number(body.partial_amount)
      if (isNaN(amt) || amt <= 0) return error('partial_amount must be a positive number')

      // Directed settlement of a single obligation, through the one engine.
      // This replaced record_partial_payment(), a fifth settlement
      // implementation with its own semantics, no allocation ledger, no row
      // lock and no idempotency. That function was dropped from the database in
      // v41 — it had no caller left, and a deployed SECURITY DEFINER function
      // that mutates money is a liability whether or not anything calls it.
      const partRef = `PART-${String(ids[0]).slice(0, 8)}-${Date.now()}`
      const { data: pc } = await supabaseAdmin
        .from('contributions').select('member_id, amount, amount_paid').eq('id', ids[0]).single()
      if (!pc) return error('Contribution not found', 404)

      const { error: pTxErr } = await supabaseAdmin.from('transactions').insert({
        member_id: pc.member_id, type: 'contribution', amount: amt,
        reference: partRef, status: 'pending', related_id: ids[0],
        description: `Instalment (${method})${note ? ` — ${note}` : ''}`,
      })
      if (pTxErr) return error(`Could not record instalment: ${pTxErr.message}`, 500)

      const { error: pSetErr } = await supabaseAdmin.rpc('settle_payment', {
        p_reference: partRef, p_confirmed_amount: amt,
        p_scope: 'slot', p_target_contributions: [ids[0]],
      })
      if (pSetErr) return error(`Could not record instalment: ${pSetErr.message}`, 500)

      await supabaseAdmin.from('contributions')
        .update({ payment_method: method, payment_note: note }).eq('id', ids[0])

      const { data: after } = await supabaseAdmin
        .from('contributions').select('amount, amount_paid, status').eq('id', ids[0]).single()
      const row = {
        paid_so_far: Number(after?.amount_paid ?? 0),
        amount_due:  Number(after?.amount ?? 0),
        fully_paid:  after?.status === 'paid',
      }

      // Audit transaction for the instalment
      const { data: c } = await supabaseAdmin
        .from('contributions').select('member_id, group_id, susu_groups(name), members(full_name, phone)')
        .eq('id', ids[0]).single()
      if (c) {
        await supabaseAdmin.from('transactions').insert({
          member_id: c.member_id, type: 'contribution', amount: amt,
          reference: `PART-${ids[0].slice(0, 8)}-${Date.now()}`,
          description: `Instalment (${method}) toward ${(c.susu_groups as any)?.name ?? 'susu'}${note ? ` — ${note}` : ''}`,
          status: 'success',
        }).then(() => {}, () => {})

        const m = (c as any).members
        if (m?.phone) {
          if (row?.fully_paid) {
            await sendSMS(m.phone, smsTemplates.paymentConfirmedDetailed(
              m.full_name.split(' ')[0], Number(row.amount_due).toFixed(2), (c.susu_groups as any)?.name ?? 'your susu', 1))
          } else {
            await sendSMS(m.phone,
              `Hi ${m.full_name.split(' ')[0]}, we received GHS ${amt.toFixed(2)} toward your ${(c.susu_groups as any)?.name ?? 'susu'}. Paid so far: GHS ${Number(row.paid_so_far).toFixed(2)} of GHS ${Number(row.amount_due).toFixed(2)}. Thank you!`)
          }
          await notifyAdmins(
            `${m.full_name} paid GHS ${amt.toFixed(2)} toward ${(c.susu_groups as any)?.name ?? 'susu'}` +
            (row?.fully_paid ? ' (now fully paid).' : ` (GHS ${Number(row?.paid_so_far ?? 0).toFixed(2)} of GHS ${Number(row?.amount_due ?? 0).toFixed(2)}).`))
        }
      }
      return json({
        partial: true, paid_so_far: row?.paid_so_far, amount_due: row?.amount_due, fully_paid: row?.fully_paid,
        message: row?.fully_paid ? 'Contribution fully paid' : `Instalment recorded — GHS ${Number(row?.paid_so_far ?? 0).toFixed(2)} of GHS ${Number(row?.amount_due ?? 0).toFixed(2)}`,
      })
    }

    // Fetch the rows and keep only ones actually awaiting payment
    const { data: rows } = await supabaseAdmin
      .from('contributions')
      .select('id, member_id, group_id, amount, due_date, status, members(full_name, phone), susu_groups(name)')
      .in('id', ids)

    const payable = (rows ?? []).filter(r => ['pending', 'overdue'].includes(r.status))
    const skipped = (rows ?? []).length - payable.length
    if (payable.length === 0) return error('None of the selected contributions are awaiting payment')

    /*
     * Settled through the canonical engine, using DIRECTED allocation.
     *
     * This path used to do a blanket UPDATE: it wrote no allocation rows,
     * never set amount_paid, and never touched credit. It is the busiest path
     * on the platform — 3,978 contributions, GHS 403,940 — so the whole of
     * that history has no record of what any payment covered.
     *
     * It cannot simply call the policy allocator, because the two answer
     * different questions: the admin is ASSERTING which specific days were
     * paid in cash, not asking the engine to choose. So the engine is called
     * with p_target_contributions — same locking, same allocation ledger, same
     * atomicity, same audit trail, but the caller decides the set.
     */
    const receipts: any[] = []
    const batches = new Map<string, typeof payable>()
    for (const r of payable) {
      const key = `${r.member_id}|${r.group_id}`
      if (!batches.has(key)) batches.set(key, [])
      batches.get(key)!.push(r)
    }

    for (const batch of batches.values()) {
      const first  = batch[0] as any
      const total  = batch.reduce((s, r) => s + Number(r.amount), 0)
      const days   = batch.length
      const gName  = first.susu_groups?.name ?? 'your susu group'
      const ref    = `MAN-${method.toUpperCase()}-${Date.now()}-${first.member_id.slice(0, 6)}`
      const ids    = batch.map(r => r.id)

      // Recorded as pending, then settled — so a failure mid-way leaves the
      // payment visibly unsettled rather than half-applied.
      const { error: txErr } = await supabaseAdmin.from('transactions').insert({
        member_id: first.member_id, type: 'contribution', amount: total,
        reference: ref, status: 'pending', related_id: ids[0],
        description: `${label(method)} payment collected by admin — ${days} day${days > 1 ? 's' : ''} for "${gName}"${note ? ` · ${note}` : ''}`,
      })
      if (txErr) return error(`Could not record the payment: ${txErr.message}`, 500)

      const { error: setErr } = await supabaseAdmin.rpc('settle_payment', {
        p_reference: ref,
        p_confirmed_amount: total,
        p_scope: 'slot',
        p_target_contributions: ids,
      })
      if (setErr) return error(`Could not settle the payment: ${setErr.message}`, 500)

      // The method is metadata about HOW it was collected; the engine records
      // the money itself.
      await supabaseAdmin.from('contributions')
        .update({ payment_method: method, payment_note: note })
        .in('id', ids)

      if (!body.no_sms && first.members?.phone) {
        await sendSMS(first.members.phone,
          `Hi ${first.members.full_name?.split(' ')[0] ?? ''}, we received your ${label(method).toLowerCase()} payment of GHS ${total.toLocaleString()} for ${gName} (${days} day${days > 1 ? 's' : ''}). Thank you!`)
      }
      // The admin gets a record of every payment, however it was collected
      await notifyAdmins(
        `${first.members?.full_name ?? 'A member'} paid GHS ${total.toFixed(2)} for ${gName} (${days} day${days > 1 ? 's' : ''}, ${label(method).toLowerCase()}).`)

      receipts.push({ member: first.members?.full_name, group: gName, days, total, reference: ref })
    }

    return json({
      message: `${payable.length} contribution${payable.length > 1 ? 's' : ''} marked as paid`,
      marked_paid: payable.length,
      skipped_already_paid: skipped,
      receipts,
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error: ' + (e as Error).message, 500)
  }
})
