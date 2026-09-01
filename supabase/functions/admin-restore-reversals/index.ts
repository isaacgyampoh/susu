import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'
import { applyPaymentToSchedule }  from '../_shared/settle.ts'
import { notifyAdmins }            from '../_shared/africas-talking.ts'

/*
 * Restore payments the reconcile reversed.
 *
 * The reconcile reversed any in-app payment whose ID wasn't pasted — but the
 * provider's report is paginated, so an operator copying one page reversed
 * real payments from the other pages. Every reversal was written to the audit
 * log with the payment's details, which is what makes this restorable: each
 * logged reversal whose day is still unpaid is settled again (with spillover),
 * and its transaction flipped back to success.
 *
 * Safe to re-run: already-restored days are skipped.
 *
 *   POST { dry_run?: boolean }
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST') return error('Method not allowed', 405)

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  // ── DISABLED IN PHASE 04 ────────────────────────────────────────────────
  // This tool existed to un-reverse payments that had been reversed — repair work made necessary by
  // finding F-02, where the unique index on contributions.paystack_ref
  // silently rejected every day after the first in a multi-day settlement.
  //
  // That defect is fixed at source (v26 removed the constraint) and its
  // historical damage was reconciled by v27 with a full audit trail. The tool
  // is therefore obsolete.
  //
  // It is disabled rather than deleted for two reasons. It moves money
  // OUTSIDE the canonical settle_payment() engine, so leaving it callable
  // would mean two active settlement mechanisms — exactly what this phase set
  // out to end. And its call into the settlement module now uses a signature
  // that no longer exists, so it could not work correctly even if invoked.
  //
  // If a future reconciliation genuinely needs this, rebuild it on
  // settle_payment() so it inherits atomicity, locking and an audit trail.
  return error(
    'This repair tool is disabled. Settlement now runs through the canonical ' +
    'transactional engine, which makes the defect it corrected impossible. ' +
    'See docs/phase-03/financial-reconciliation.md.', 410)

  try {
    const body = await req.json().catch(() => ({}))
    const dryRun = body.dry_run === true

    const { data: logs, error: dbErr } = await supabaseAdmin
      .from('audit_log')
      .select('id, entity_id, details, created_at')
      .eq('action', 'payment.reconciled_reversed')
      .order('created_at', { ascending: false })
      .limit(500)
    if (dbErr) return error(dbErr.message, 500)

    // Latest log per contribution wins
    const byContribution = new Map<string, any>()
    for (const l of logs ?? []) {
      if (!byContribution.has(l.entity_id)) byContribution.set(l.entity_id, l)
    }

    const restored: any[] = []
    const skipped: any[] = []

    for (const [cid, log] of byContribution) {
      const d = (log.details ?? {}) as any

      const { data: c } = await supabaseAdmin
        .from('contributions')
        .select('id, status, amount, due_date, members!member_id(full_name), susu_groups(name)')
        .eq('id', cid).single()
      if (!c) continue
      if (c.status === 'paid') { skipped.push({ member: d.member, amount: d.amount, why: 'already paid again' }); continue }

      // Find its reversed transaction by the provider order id we logged
      let tx: any = null
      if (d.order_id) {
        const { data: txns } = await supabaseAdmin
          .from('transactions')
          .select('id, reference, amount, paystack_data, status, description')
          .eq('status', 'failed')
          .ilike('description', 'Reversed — not present%')
          .limit(500)
        tx = (txns ?? []).find((t: any) =>
          (t.paystack_data as any)?.provider_order_id === d.order_id) ?? null
      }

      const row = {
        member: d.member ?? (c as any).members?.full_name,
        group: d.group ?? (c as any).susu_groups?.name,
        amount: Number(d.amount ?? c.amount),
        due_date: c.due_date,
        order_id: d.order_id ?? null,
      }

      if (dryRun) { restored.push(row); continue }

      const reference = tx?.reference ?? `RESTORE-${cid.slice(0, 8)}-${Date.now()}`
      await applyPaymentToSchedule(cid, row.amount, reference)

      if (tx) {
        await supabaseAdmin.from('transactions')
          .update({ status: 'success', description: 'Restored — reversal was made from an incomplete provider list' })
          .eq('id', tx.id)
      }

      await supabaseAdmin.from('audit_log').insert({
        admin_id: admin.sub, admin_name: admin.full_name ?? admin.email,
        action: 'payment.reversal_restored', entity_type: 'contribution',
        entity_id: cid, entity_label: `GHS ${row.amount.toFixed(2)} · ${row.due_date}`,
        details: row,
      }).then(() => {}, () => {})

      restored.push(row)
    }

    // One summary to the admins rather than a text per restored day —
    // members already had their receipt when they first paid.
    if (!dryRun && restored.length > 0) {
      const total = restored.reduce((s, r) => s + Number(r.amount ?? 0), 0)
      await notifyAdmins(`${restored.length} reversed payment(s) restored, GHS ${total.toFixed(2)} total.`)
    }

    return json({
      dry_run: dryRun,
      restored: restored.length,
      skipped: skipped.length,
      details: restored,
      message: restored.length === 0
        ? 'Nothing to restore — no reversed payments remain unpaid.'
        : dryRun
          ? `${restored.length} reversed payment(s) would be restored.`
          : `${restored.length} payment(s) restored and marked paid again.`,
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
