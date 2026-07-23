import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'
import { sendSMS, smsTemplates, notifyAdmins } from '../_shared/africas-talking.ts'
import { applyPaymentToSchedule } from '../_shared/settle.ts'

/*
 * Reconcile in-app payments against the provider's own report.
 *
 * A removed "force settle" action once marked pending provider payments as
 * received, so days were counted as collected that never were. The provider's
 * status endpoint cannot be trusted to undo this (it reports PENDING even for
 * completed payments), so the truth comes from the operator: paste the
 * transaction IDs the provider lists as Successful, and anything else marked
 * in-app for that window is put back to unpaid.
 *
 * Manual (admin-recorded) payments are never touched — they never went
 * through the provider, so the report says nothing about them.
 *
 * Nothing is deleted. Each reversal restores the day, restores its penalty,
 * marks the transaction failed, and is written to the audit log.
 *
 *   POST {
 *     keep_order_ids: string[],   // provider TRANSACTION IDs that succeeded
 *     from?: 'YYYY-MM-DD',        // window by payment time (default last 7d)
 *     to?:   'YYYY-MM-DD',
 *     dry_run?: boolean           // preview without changing anything
 *   }
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

    const keep = new Set(
      (Array.isArray(body.keep_order_ids) ? body.keep_order_ids : [])
        .map((s: string) => String(s).trim()).filter(Boolean))
    if (keep.size === 0) {
      return error('Paste at least one successful transaction ID from the provider report, otherwise every in-app payment would be reversed.')
    }

    const from = body.from ? `${body.from}T00:00:00Z`
                           : new Date(Date.now() - 7 * 864e5).toISOString()
    const to   = body.to   ? `${body.to}T23:59:59Z` : new Date().toISOString()

    // In-app payments in the window: paid, and carrying a provider reference
    const { data: paidRows, error: dbErr } = await supabaseAdmin
      .from('contributions')
      .select('id, amount, due_date, paid_at, paystack_ref, member_id, ' +
              'members!member_id(full_name), susu_groups(name)')
      .eq('status', 'paid')
      .not('paystack_ref', 'is', null)
      .gte('paid_at', from)
      .lte('paid_at', to)
      .limit(2000)
    if (dbErr) return error(dbErr.message, 500)

    // Resolve each one's provider order id through its transaction
    const refs = [...new Set((paidRows ?? []).map((c: any) => c.paystack_ref).filter(Boolean))]
    const orderByRef = new Map<string, string | null>()
    for (let i = 0; i < refs.length; i += 100) {
      const { data: txns } = await supabaseAdmin
        .from('transactions').select('reference, paystack_data')
        .in('reference', refs.slice(i, i + 100))
      for (const t of txns ?? []) {
        orderByRef.set(t.reference, (t.paystack_data as any)?.provider_order_id ?? null)
      }
    }

    const today = new Date().toISOString().slice(0, 10)
    const toReverse: any[] = []
    const kept: any[] = []

    for (const c of paidRows ?? []) {
      const orderId = orderByRef.get(c.paystack_ref!) ?? null
      const row = {
        contribution_id: c.id,
        member: (c as any).members?.full_name,
        group: (c as any).susu_groups?.name,
        amount: Number(c.amount),
        due_date: c.due_date,
        order_id: orderId,
      }
      if (orderId && keep.has(orderId)) kept.push(row)
      else toReverse.push(row)
    }

    // The other direction: payments NaloPay confirms successful whose webhook
    // callback never landed — still sitting pending here. Dorcas's case.
    const { data: pendingTx } = await supabaseAdmin
      .from('transactions')
      .select('id, reference, amount, type, related_id, batch_id, member_id, paystack_data')
      .eq('status', 'pending')
      .in('type', ['contribution', 'bulk_contribution', 'registration_fee'])
      .gte('created_at', from)
      .lte('created_at', to)
      .limit(500)

    const toSettle = (pendingTx ?? [])
      .filter((t: any) => {
        const oid = (t.paystack_data as any)?.provider_order_id
        return oid && keep.has(oid)
      })
      .map((t: any) => ({
        tx: t,
        order_id: (t.paystack_data as any).provider_order_id,
        amount: Number(t.amount),
        reference: t.reference,
      }))

    if (dryRun) {
      return json({
        dry_run: true,
        to_settle: toSettle.length,
        settle_total: Math.round(toSettle.reduce((s, r) => s + r.amount, 0) * 100) / 100,
        settle_details: toSettle.map(r => ({ reference: r.reference, order_id: r.order_id, amount: r.amount })),
        confirmed: kept.length,
        confirmed_total: Math.round(kept.reduce((s, r) => s + r.amount, 0) * 100) / 100,
        to_reverse: toReverse.length,
        reverse_total: Math.round(toReverse.reduce((s, r) => s + r.amount, 0) * 100) / 100,
        details: toReverse,
        message: `${toSettle.length} confirmed payment(s) missing locally will be settled; ${toReverse.length} unconfirmed will be reversed.`,
      })
    }

    // Settle the missing ones first — mark days paid, receipts out
    let settledMissing = 0
    for (const r of toSettle) {
      const tx = r.tx
      const now = new Date().toISOString()
      if (tx.batch_id) {
        await supabaseAdmin.from('contributions')
          .update({ status: 'paid', paid_at: now, paystack_ref: tx.reference })
          .eq('batch_id', tx.batch_id).neq('status', 'paid')
      } else if (tx.related_id) {
        // Spread with the shared settlement: a 300-cedi payment on a 100/day
        // plan clears three days; any remainder banks as a part payment.
        await applyPaymentToSchedule(tx.related_id, Number(tx.amount ?? 0), tx.reference)
      }
      await supabaseAdmin.from('transactions')
        .update({ status: 'success', paystack_data: { ...(tx.paystack_data ?? {}), reconciled_success: true } as never })
        .eq('id', tx.id)
      if (tx.type === 'registration_fee') {
        await supabaseAdmin.from('kyc_applications')
          .update({ registration_fee_paid: true })
          .eq('created_member_id', tx.member_id).eq('registration_fee_paid', false)
          .then(() => {}, () => {})
      }
      // Receipt + admin note, same as a normal settlement
      if (tx.member_id) {
        const { data: m } = await supabaseAdmin
          .from('members').select('full_name, phone').eq('id', tx.member_id).single()
        if (m?.phone) {
          let group = 'your susu'
          if (tx.related_id) {
            const { data: cc } = await supabaseAdmin
              .from('contributions').select('susu_groups(name)').eq('id', tx.related_id).single()
            group = (cc?.susu_groups as { name?: string } | null)?.name ?? group
          }
          await sendSMS(m.phone, smsTemplates.paymentConfirmedDetailed(
            m.full_name.split(' ')[0], Number(tx.amount).toFixed(2), group, 1))
          await notifyAdmins(smsTemplates.adminPaymentReceived(m.full_name, Number(tx.amount).toFixed(2), group))
        }
      }
      await supabaseAdmin.from('audit_log').insert({
        admin_id: admin.sub, admin_name: admin.full_name ?? admin.email,
        action: 'payment.reconciled_settled', entity_type: 'transaction',
        entity_id: tx.id, entity_label: r.order_id,
        details: { amount: tx.amount, order_id: r.order_id },
      }).then(() => {}, () => {})
      settledMissing++
    }

    let reversed = 0
    for (const r of toReverse) {
      const { data: c } = await supabaseAdmin
        .from('contributions').select('id, status, due_date, paystack_ref')
        .eq('id', r.contribution_id).single()
      if (!c || c.status !== 'paid') continue

      await supabaseAdmin.from('contributions').update({
        status: c.due_date < today ? 'overdue' : 'pending',
        paid_at: null, paystack_ref: null, payment_method: null, amount_paid: 0,
      }).eq('id', c.id)

      await supabaseAdmin.from('payment_penalties')
        .update({ is_paid: false, paid_at: null })
        .eq('contribution_id', c.id).then(() => {}, () => {})

      if (c.paystack_ref) {
        await supabaseAdmin.from('transactions')
          .update({ status: 'failed', description: 'Reversed — not present as successful in the provider report' })
          .eq('reference', c.paystack_ref).then(() => {}, () => {})
      }

      await supabaseAdmin.from('audit_log').insert({
        admin_id: admin.sub, admin_name: admin.full_name ?? admin.email,
        action: 'payment.reconciled_reversed', entity_type: 'contribution',
        entity_id: c.id, entity_label: `GHS ${r.amount.toFixed(2)} · ${r.due_date}`,
        details: r,
      }).then(() => {}, () => {})

      reversed++
    }

    return json({
      dry_run: false,
      confirmed: kept.length,
      settled_missing: settledMissing,
      reversed,
      details: toReverse,
      message: `${settledMissing} confirmed payment(s) settled, ${reversed} unconfirmed reversed, ${kept.length} already correct.`,
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
