import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'
import { sendSMS }                 from '../_shared/africas-talking.ts'

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

      const { data: pr, error: prErr } = await supabaseAdmin.rpc('record_partial_payment', {
        p_contribution_id: ids[0], p_amount: amt, p_method: method, p_note: note,
      })
      if (prErr) return error(`Could not record instalment: ${prErr.message}. Run migration v22.`, 500)
      const row = Array.isArray(pr) ? pr[0] : pr

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
          const { sendSMS, smsTemplates } = await import('../_shared/africas-talking.ts')
          if (row?.fully_paid) {
            await sendSMS(m.phone, smsTemplates.paymentConfirmedDetailed(
              m.full_name.split(' ')[0], Number(row.amount_due).toFixed(2), (c.susu_groups as any)?.name ?? 'your susu', 1))
          } else {
            await sendSMS(m.phone,
              `Hi ${m.full_name.split(' ')[0]}, we received GHS ${amt.toFixed(2)} toward your ${(c.susu_groups as any)?.name ?? 'susu'}. Paid so far: GHS ${Number(row.paid_so_far).toFixed(2)} of GHS ${Number(row.amount_due).toFixed(2)}. Thank you!`)
          }
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

    const now = new Date().toISOString()

    let { error: upErr } = await supabaseAdmin
      .from('contributions')
      .update({ status: 'paid', paid_at: now, payment_method: method, payment_note: note })
      .in('id', payable.map(r => r.id))
      .in('status', ['pending', 'overdue'])   // guard against races
    if (upErr && /payment_method|payment_note/.test(upErr.message)) {
      // v10 migration not applied — the payment still gets recorded
      ;({ error: upErr } = await supabaseAdmin
        .from('contributions')
        .update({ status: 'paid', paid_at: now })
        .in('id', payable.map(r => r.id))
        .in('status', ['pending', 'overdue']))
    }
    if (upErr) return error(upErr.message, 500)

    // One audit transaction + one SMS receipt per member+group batch
    const batches = new Map<string, typeof payable>()
    for (const r of payable) {
      const key = `${r.member_id}|${r.group_id}`
      if (!batches.has(key)) batches.set(key, [])
      batches.get(key)!.push(r)
    }

    const receipts: any[] = []
    for (const batch of batches.values()) {
      const first  = batch[0] as any
      const total  = batch.reduce((s, r) => s + Number(r.amount), 0)
      const days   = batch.length
      const gName  = first.susu_groups?.name ?? 'your susu group'
      const ref    = `MAN-${method.toUpperCase()}-${Date.now()}-${first.member_id.slice(0, 6)}`

      await supabaseAdmin.from('transactions').insert({
        member_id: first.member_id, type: 'contribution', amount: total,
        reference: ref, status: 'success',
        description: `${label(method)} payment collected by admin — ${days} day${days > 1 ? 's' : ''} for "${gName}"${note ? ` · ${note}` : ''}`,
      })

      if (!body.no_sms && first.members?.phone) {
        await sendSMS(first.members.phone,
          `Hi ${first.members.full_name?.split(' ')[0] ?? ''}, we received your ${label(method).toLowerCase()} payment of GHS ${total.toLocaleString()} for ${gName} (${days} day${days > 1 ? 's' : ''}). Thank you!`)
      }

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
