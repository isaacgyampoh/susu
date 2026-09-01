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

  // REMOVED IN PHASE 04, EMPTIED IN PHASE 07.
  //
  // A one-time repair for payments that had credited only one of a member's
  // groups. The defect is fixed at source — settle_payment() is per-membership
  // and the credit ledger is per-membership — and the historical repair has
  // been applied. What remained was a second path that wrote contribution and
  // credit state outside the canonical engine, which is exactly the
  // duplicate-engine problem this rebuild set out to end.
  return error(
    'This repair tool has been removed. Credit is per-membership in the ' +
    'canonical engine, which makes the defect it corrected impossible.', 410)
})
