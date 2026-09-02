import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin } from '../_shared/supabase-admin.ts'
import { requireAdmin }  from '../_shared/jwt.ts'
import { paymentStatus } from '../_shared/nalo.ts'
import { provider }      from '../_shared/mode.ts'
import { settlePayment } from '../_shared/settle.ts'
import { settleRegistrationFee } from '../_shared/registration-fee.ts'

/**
 * The unresolved financial state, exposed for a human decision.
 *
 * Two populations neither this system nor I can resolve from data alone:
 *
 *   13 approved registrations with an unpaid fee (GHS 1,320.50)
 *   402 payments pending for more than 48 hours (GHS 40,658)
 *
 * They are NOT hidden, NOT auto-resolved and NOT guessed at. This endpoint
 * lists them with everything needed to decide, and records every resolution in
 * the audit log.
 *
 * ────────────────────────────────────────────────────────────────────────
 * THERE IS NO "MARK SUCCESSFUL".
 *
 * It is the obvious button to build and it is the one that must not exist. A
 * payment is successful when the provider says so — a console cannot know
 * whether money moved, and a button asserting that it did would manufacture a
 * financial fact. `refresh` is the closest safe equivalent: it re-asks NaloPay
 * and settles ONLY if NaloPay confirms, through the same canonical engine a
 * webhook would use. An operator can therefore clear a genuinely-completed
 * payment, and cannot clear one that never completed.
 *
 * The other actions — abandoned, reviewed, note, escalate, suspend — assert
 * nothing about the provider. They move no money at all; they record what a
 * named human decided, and when.
 */

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  const actor = {
    admin_id:   admin.sub as string,
    admin_name: (admin.name as string) ?? (admin.full_name as string) ?? 'admin',
  }
  const audit = (row: Record<string, unknown>) =>
    supabaseAdmin.from('audit_log').insert({ ...actor, ...row })

  try {
    // ── Bulk provider classification: READ ONLY ───────────────────────
    // 315 of the 402 stuck payments can only be resolved by asking NaloPay,
    // and `refresh` asks about one at a time — 315 clicks is not a workflow.
    //
    // This asks in bulk and SETTLES NOTHING. Classification is a report;
    // moving money stays a per-payment, deliberate act through `refresh`,
    // which goes through the canonical engine. Separating the two means a
    // reconciliation sweep can never settle 315 payments as a side effect of
    // someone wanting to know where they stand.
    if (req.method === 'GET' && new URL(req.url).searchParams.get('action') === 'classify') {
      if (provider() !== 'nalo') return error('No payment provider is configured to ask.', 503)

      const url = new URL(req.url)
      const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 50), 1), 200)
      const offset = Math.max(Number(url.searchParams.get('offset') ?? 0), 0)

      const { data: rows, error: dbErr } = await supabaseAdmin
        .from('transactions')
        .select('id, reference, amount, type, created_at, member_id, related_id, paystack_data')
        .eq('status', 'pending')
        .lt('created_at', new Date(Date.now() - 48 * 3600e3).toISOString())
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1)
      if (dbErr) return error(dbErr.message, 500)

      const out: Record<string, unknown>[] = []
      for (const t of rows ?? []) {
        const orderId = (t.paystack_data as { provider_order_id?: string } | null)?.provider_order_id
        const base = {
          id: t.id, reference: t.reference, amount: Number(t.amount), type: t.type,
          created: t.created_at, provider_reference: orderId ?? null,
          age_days: Math.floor((Date.now() - new Date(t.created_at).getTime()) / 86_400_000),
        }

        // No provider reference: the prompt never reached NaloPay, so no money
        // can have moved against it. That is evidence, not a guess.
        if (!orderId) { out.push({ ...base, classification: 'NEVER_REACHED_PROVIDER' }); continue }

        const s = await paymentStatus(orderId)
        // NaloPay not answering is NOT evidence of anything.
        if (!s)          { out.push({ ...base, classification: 'UNKNOWN_REQUIRES_REVIEW', note: 'NaloPay did not answer' }); continue }
        if (s.pending)   { out.push({ ...base, classification: 'STILL_PENDING', provider_amount: s.amount }); continue }
        if (!s.settled)  { out.push({ ...base, classification: 'CONFIRMED_FAILED', provider_amount: s.amount }); continue }

        out.push({
          ...base,
          classification: 'CONFIRMED_SUCCESS',
          provider_amount: s.amount,
          // Surfaced, never acted on here: a provider amount below the
          // recorded one is a short payment and needs a human.
          amount_matches: Math.abs(s.amount - Number(t.amount)) < 0.005,
        })
      }

      const counts: Record<string, number> = {}
      const values: Record<string, number> = {}
      for (const r of out) {
        const c = r.classification as string
        counts[c] = (counts[c] ?? 0) + 1
        values[c] = (values[c] ?? 0) + (r.amount as number)
      }

      await audit({
        action: 'reconciliation.classified', entity_type: 'system', entity_id: null,
        entity_label: `${out.length} payment(s) classified against NaloPay`,
        details: { counts, values, offset, limit },
      })

      return json({
        checked: out.length, offset, limit, counts, values, items: out,
        note: 'Read only. Nothing was settled. Use action "refresh" on an individual '
            + 'payment to settle one NaloPay confirms.',
      })
    }

    // ── GET: everything awaiting a decision ─────────────────────────────
    if (req.method === 'GET') {
      const { data, error: rpcErr } = await supabaseAdmin.rpc('get_reconciliation_queue')
      if (rpcErr) return error(rpcErr.message, 500)
      return json(data)
    }

    if (req.method !== 'POST') return error('Method not allowed', 405)

    const body = await req.json()
    const { kind, id, action, reason } = body

    // `refresh` asks the provider rather than asserting anything, so it needs
    // no justification. Everything else is a human decision and must carry one.
    const needsReason = !(kind === 'payment' && action === 'refresh')
    if (needsReason && (typeof reason !== 'string' || reason.trim().length < 10)) {
      return error('A resolution needs a reason of at least 10 characters — it is written to the audit log.', 400)
    }
    const why = typeof reason === 'string' ? reason.trim() : ''

    // ══════════════════════════════════════════════════════════════════════
    // REGISTRATION FEE DECISIONS
    // ══════════════════════════════════════════════════════════════════════
    if (kind === 'registration') {
      const allowed = ['fee_received', 'waived', 'pursuing', 'suspend', 'escalate', 'note']
      if (!allowed.includes(action)) {
        return error(`action must be one of: ${allowed.join(', ')}`, 400)
      }

      const { data: kyc } = await supabaseAdmin
        .from('kyc_applications')
        .select('id, full_name, registration_fee_amount, registration_fee_paid, created_member_id')
        .eq('id', id).maybeSingle()
      if (!kyc) return error('Registration not found', 404)

      const fee = Number(kyc.registration_fee_amount ?? 0)

      // 'fee_received' records money the operator has ACTUALLY TAKEN, in cash
      // or by transfer, outside the app. It is a real payment and gets a real
      // transaction row — never a bare flag flip, which would leave money
      // recorded nowhere. The application link means an applicant who is not
      // yet a member still gets a transaction; previously that case wrote none.
      if (action === 'fee_received') {
        if (fee <= 0) return error('This application has no fee due', 400)

        /*
         * ── THE GUARD IS "IS THERE ALREADY A PAYMENT", NOT "IS THE FLAG SET" ──
         *
         * This used to refuse whenever `registration_fee_paid` was true. The
         * intent was right — never record the same fee twice — but the test was
         * wrong, and it created a trap.
         *
         * Seven applications from launch week carry `registration_fee_paid =
         * true` with no transaction, no reference and no audit entry: the flag
         * was set at import, before the registration payment pipeline existed.
         * Financial invariant 13 flags them, correctly, as GHS 1,745 of claimed
         * registration income with nothing behind it. And the only tool that can
         * attach the missing evidence refused to run on them, precisely BECAUSE
         * the flag was set. The invariant demanded a record the system would not
         * let anyone create.
         *
         * A duplicate is a second TRANSACTION, so that is what is checked now.
         * The flag says what somebody once believed; the transaction is what
         * actually happened, and it is the thing that must not be written twice.
         */
        const { data: existingTx } = await supabaseAdmin
          .from('transactions')
          .select('reference')
          .eq('type', 'registration_fee').eq('status', 'success')
          .or(`kyc_application_id.eq.${kyc.id}` +
              (kyc.created_member_id ? `,member_id.eq.${kyc.created_member_id}` : ''))
          .limit(1)

        if ((existingTx ?? []).length > 0) {
          return error('This fee already has a recorded payment', 400)
        }

        const ref = `REG-MANUAL-${String(id).slice(0, 8)}-${Date.now()}`
        const { error: txErr } = await supabaseAdmin.from('transactions').insert({
          member_id: kyc.created_member_id ?? null,
          kyc_application_id: kyc.id,
          type: 'registration_fee', amount: fee, reference: ref, status: 'success',
          description: `Registration fee received outside the app — recorded by ${actor.admin_name}. ${why}`,
        })
        if (txErr) return error(`Could not record the payment: ${txErr.message}`, 500)

        // No `.eq('registration_fee_paid', false)` filter: that is what silently
        // skipped the very rows above. Idempotency comes from the transaction
        // check, not from the flag's previous value.
        await supabaseAdmin.from('kyc_applications')
          .update({ registration_fee_paid: true, registration_fee_ref: ref })
          .eq('id', id)

        /*
         * The audit entry the invariant actually looks for.
         *
         * Invariant 13 accepts either a successful transaction OR an audit_log
         * row with action 'registration.fee_received'. Nothing in the codebase
         * ever wrote that action, so half the invariant's evidence test was
         * unreachable. It is written here, where the money is recorded.
         */
        await audit({
          action: 'registration.fee_received',
          entity_type: 'kyc_application', entity_id: kyc.id,
          entity_label: kyc.full_name ?? '',
          details: { amount: fee, reference: ref, reason: why },
        })

        await supabaseAdmin.from('settlement_log').insert({
          reference: ref, event: 'registration_fee_recorded_manually',
          member_id: kyc.created_member_id, amount: fee,
          detail: { kyc_application_id: kyc.id, recorded_by: actor.admin_name, reason: why },
        })
      }

      // Everything below records a DECISION. No money moves, and
      // `registration_fee_paid` is deliberately left alone: documenting a
      // decision must never be able to masquerade as money arriving.
      const resolution: Record<string, string> = {
        waived: 'waived', pursuing: 'to_collect', suspend: 'suspended', escalate: 'escalated',
      }
      if (resolution[action]) {
        await supabaseAdmin.from('kyc_applications').update({
          fee_resolution:        resolution[action],
          fee_resolution_reason: why,
          fee_resolution_by:     actor.admin_id,
          fee_resolution_at:     new Date().toISOString(),
        }).eq('id', id)
      }

      // Suspension is the one action that changes a member's standing, so it
      // is explicit and separate: it stops further contributions being
      // scheduled against an unpaid registration. It deletes nothing.
      if (action === 'suspend') {
        if (!kyc.created_member_id) return error('This application has no member to suspend', 400)
        await supabaseAdmin.from('members')
          .update({ status: 'suspended' }).eq('id', kyc.created_member_id)
      }

      await audit({
        action: `registration.${action}`,
        entity_type: 'kyc_application', entity_id: id,
        entity_label: `${kyc.full_name} — GHS ${fee.toFixed(2)}`,
        details: { reason: why, fee, action, member_id: kyc.created_member_id },
      })
      return json({ message: `Recorded: ${action}` })
    }

    // ══════════════════════════════════════════════════════════════════════
    // STUCK PAYMENT DECISIONS
    // ══════════════════════════════════════════════════════════════════════
    if (kind === 'payment') {
      const allowed = ['refresh', 'abandoned', 'reviewed', 'note', 'escalate']
      if (action === 'mark_successful' || action === 'settle' || action === 'force') {
        return error(
          'There is no action that marks a payment successful. A payment is successful ' +
          'when the provider confirms it — use "refresh", which re-asks NaloPay and ' +
          'settles only if NaloPay says the money arrived.', 400)
      }
      if (!allowed.includes(action)) return error(`action must be one of: ${allowed.join(', ')}`, 400)

      const { data: tx } = await supabaseAdmin
        .from('transactions')
        .select('id, reference, amount, status, member_id, type, paystack_data')
        .eq('id', id).maybeSingle()
      if (!tx) return error('Payment not found', 404)

      // ── refresh: ask the provider, settle only on its word ────────────
      if (action === 'refresh') {
        if (tx.status !== 'pending') return json({ message: `Already ${tx.status}`, status: tx.status })
        if (provider() !== 'nalo')   return error('No payment provider is configured to ask.', 503)

        const orderId = (tx.paystack_data as { provider_order_id?: string } | null)?.provider_order_id
        if (!orderId) {
          return json({
            status: 'unknown',
            message: 'This payment has no provider reference, so NaloPay cannot be asked about it. '
                   + 'It predates provider-id tracking and can only be resolved from the NaloPay statement.',
          })
        }

        const s = await paymentStatus(orderId)
        if (!s) return json({ status: 'pending', message: 'NaloPay did not answer. The payment stays pending.' })

        if (s.pending) {
          await audit({
            action: 'payment.refreshed', entity_type: 'transaction', entity_id: id,
            entity_label: tx.reference, details: { provider_status: 'pending', order_id: orderId },
          })
          return json({ status: 'pending', message: 'NaloPay still reports this payment as pending.' })
        }

        if (!s.settled) {
          await supabaseAdmin.from('transactions')
            .update({ status: 'failed', description: 'NaloPay reports this payment did not complete.' })
            .eq('id', id).eq('status', 'pending')
          await audit({
            action: 'payment.provider_failed', entity_type: 'transaction', entity_id: id,
            entity_label: tx.reference, details: { provider_status: 'failed', order_id: orderId },
          })
          return json({ status: 'failed', message: 'NaloPay reports this payment did not complete. Marked failed.' })
        }

        // Confirmed. Settle through the canonical engine — the same code path
        // a webhook takes, so this cannot produce a different result from one.
        try {
          if (tx.type === 'registration_fee') {
            const r = await settleRegistrationFee(tx.reference, s.amount)
            if (r.short) {
              return json({
                status: 'short',
                message: `NaloPay confirms GHS ${r.amount.toFixed(2)} against a GHS ${r.expected.toFixed(2)} fee. `
                       + 'Nothing was settled — the shortfall needs resolving with the applicant.',
              })
            }
            await audit({
              action: 'payment.settled_on_refresh', entity_type: 'transaction', entity_id: id,
              entity_label: tx.reference,
              details: { amount: r.amount, kind: 'registration_fee', confirmed_by: 'nalopay' },
            })
            return json({ status: 'settled', message: `Registration fee of GHS ${r.amount.toFixed(2)} settled.` })
          }

          const scope = (tx.paystack_data as { scope?: string } | null)?.scope === 'slot' ? 'slot' : 'member'
          const r = await settlePayment(tx.reference, s.amount, scope)
          await audit({
            action: 'payment.settled_on_refresh', entity_type: 'transaction', entity_id: id,
            entity_label: tx.reference,
            details: { days_cleared: r.daysCleared, groups: r.groups, confirmed_by: 'nalopay' },
          })
          return json({
            status: 'settled', days_cleared: r.daysCleared, groups: r.groups,
            allocations: r.allocations,
            message: `NaloPay confirms this payment. Settled — ${r.daysCleared} day(s) cleared.`,
          })
        } catch (e) {
          console.error('reconciliation refresh settlement failed:', (e as Error).message)
          return error('NaloPay confirmed the payment but settling it failed. It stays pending; try again.', 500)
        }
      }

      // ── abandoned: asserts nothing about the provider ─────────────────
      if (action === 'abandoned') {
        if (tx.status !== 'pending') return error(`This payment is already ${tx.status}`, 400)
        await supabaseAdmin.from('transactions')
          .update({ status: 'failed', description: `Marked abandoned by admin. ${why}` })
          .eq('id', id).eq('status', 'pending')
        await audit({
          action: 'payment.marked_abandoned', entity_type: 'transaction', entity_id: id,
          entity_label: `${tx.reference} — GHS ${Number(tx.amount).toFixed(2)}`,
          details: {
            reason: why, amount: Number(tx.amount),
            note: 'No contribution was settled. This records that the payment is not expected to arrive.',
          },
        })
        return json({ message: 'Recorded as abandoned' })
      }

      // ── reviewed / note / escalate: audit trail only ──────────────────
      await audit({
        action: `payment.${action}`, entity_type: 'transaction', entity_id: id,
        entity_label: `${tx.reference} — GHS ${Number(tx.amount).toFixed(2)}`,
        details: { reason: why, amount: Number(tx.amount), status_at_time: tx.status },
      })
      return json({ message: `Recorded: ${action}` })
    }

    return error('kind must be "registration" or "payment"', 400)
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
