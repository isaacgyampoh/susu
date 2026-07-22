import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'

/*
 * Reverse a payment recorded in error.
 *
 * A day goes back to unpaid, its transaction is marked reversed, and any
 * penalty cleared by that payment is restored. Used when money was recorded
 * that never actually arrived — a mistyped entry, or a provider payment that
 * was marked settled while it was still pending.
 *
 * Nothing is deleted: the reversal is written to the audit log with who did
 * it and why, so the history stays honest.
 *
 *   POST { contribution_id, reason? }
 */
async function audit(admin: any, action: string, entityId: string, label: string, details: unknown) {
  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.sub, admin_name: admin.full_name ?? admin.email,
    action, entity_type: 'contribution', entity_id: entityId, entity_label: label, details,
  }).then(() => {}, () => {})
}

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST') return error('Method not allowed', 405)

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  try {
    const { contribution_id, reason } = await req.json()
    if (!contribution_id) return error('contribution_id is required')

    const { data: c } = await supabaseAdmin
      .from('contributions')
      .select('id, status, amount, due_date, paid_at, paystack_ref, member_id, group_id, susu_groups(name)')
      .eq('id', contribution_id).single()
    if (!c) return error('Contribution not found', 404)
    if (c.status !== 'paid') return error('That day is not marked paid, so there is nothing to reverse')

    // Back to what it would be if it had never been paid
    const today = new Date().toISOString().slice(0, 10)
    const restored = c.due_date < today ? 'overdue' : 'pending'

    const { error: upErr } = await supabaseAdmin
      .from('contributions')
      .update({
        status: restored,
        paid_at: null,
        paystack_ref: null,
        payment_method: null,
        amount_paid: 0,
      })
      .eq('id', contribution_id)
    if (upErr) return error(upErr.message, 500)

    // Restore any penalty this payment had cleared
    await supabaseAdmin.from('payment_penalties')
      .update({ is_paid: false, paid_at: null })
      .eq('contribution_id', contribution_id)
      .then(() => {}, () => {})

    // Mark the matching transaction reversed rather than deleting it
    if (c.paystack_ref) {
      await supabaseAdmin.from('transactions')
        .update({ status: 'failed', description: `Reversed by admin${reason ? ` — ${reason}` : ''}` })
        .eq('reference', c.paystack_ref)
        .then(() => {}, () => {})
    }
    await supabaseAdmin.from('transactions')
      .update({ status: 'failed' })
      .eq('related_id', contribution_id).eq('status', 'success')
      .then(() => {}, () => {})

    await audit(admin, 'payment.reversed', contribution_id,
      `GHS ${Number(c.amount).toFixed(2)} · ${c.due_date}`, {
        amount: c.amount,
        due_date: c.due_date,
        group: (c.susu_groups as { name?: string } | null)?.name,
        member_id: c.member_id,
        reason: reason ?? null,
      })

    return json({
      reversed: true,
      contribution_id,
      restored_status: restored,
      message: `GHS ${Number(c.amount).toFixed(2)} for ${c.due_date} is marked unpaid again.`,
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
