import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'

/*
 * Reverse a payment recorded in error.
 *
 * A day goes back to unpaid, every payment that had claimed it is marked
 * failed, any penalty it cleared is restored, and any credit those payments
 * banked is offset. Used when money was recorded that never actually arrived —
 * a mistyped entry, or a payment marked settled while it was still pending.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PHASE 07: this used to reverse the DAY and nothing else.
 *
 * It restored the contribution and marked the transaction failed, but left
 * `payment_allocations` untouched. So after an undo the allocation ledger
 * still said this payment covered that day, while the day said nothing had
 * paid it — which is exactly the state financial invariant #8
 * (`allocation_against_unsettled_day`) exists to detect. An operator
 * correcting a typo would have tripped the alarm built to catch F-02.
 *
 * It also left behind any credit those payments had banked: money the system
 * had just declared never arrived stayed spendable on the member's next day.
 *
 * And it did four unrelated writes with no transaction around them, so a
 * failure part-way left a day unpaid with its payment still successful.
 *
 * All three are now the database's problem, in `reverse_contribution_payment()`
 * — one transaction, one row lock. Nothing is deleted: allocations are stamped
 * reversed, credit is offset by a negative entry, and the whole before-state is
 * appended to `settlement_log`.
 *
 *   POST { contribution_id, reason }
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST') return error('Method not allowed', 405)

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  try {
    const { contribution_id, reason } = await req.json()
    if (!contribution_id) return error('contribution_id is required')

    // Reversing money requires a stated reason, the same as an approval
    // override. The database enforces this too — this check exists to give a
    // usable message rather than a raised exception.
    if (typeof reason !== 'string' || reason.trim().length < 10) {
      return error('A reversal needs a reason of at least 10 characters — it is written to the audit log.', 400)
    }

    const { data, error: rpcErr } = await supabaseAdmin.rpc('reverse_contribution_payment', {
      p_contribution_id: contribution_id,
      p_admin_id:        admin.sub,
      p_admin_name:      (admin.full_name as string) ?? (admin.name as string) ?? (admin.email as string) ?? 'admin',
      p_reason:          reason.trim(),
    })

    if (rpcErr) {
      // The engine's own messages are written for an operator to read.
      const msg = rpcErr.message ?? 'Could not reverse this payment'
      const known = /not found|nothing has been paid|at least 10 characters/i.test(msg)
      if (!known) console.error('reverse_contribution_payment failed:', msg)
      return error(msg.replace(/^.*?ERROR:\s*/, ''), known ? 400 : 500)
    }

    const r = (data ?? {}) as {
      restored_to?: string; freed?: number; references?: string[]
      credit_entries_reversed?: number
    }

    return json({
      reversed: true,
      contribution_id,
      restored_status: r.restored_to,
      // What the reversal actually touched, rather than just "done".
      freed: r.freed,
      payments_reversed: r.references ?? [],
      credit_entries_reversed: r.credit_entries_reversed ?? 0,
      message: `That day is marked unpaid again. ${(r.references ?? []).length} payment(s) reversed.`,
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
