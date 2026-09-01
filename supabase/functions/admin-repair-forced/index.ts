import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'

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

  // REMOVED IN PHASE 04, EMPTIED IN PHASE 07.
  //
  // This reconciled in-app payments against a pasted NaloPay list — repair
  // work made necessary by finding F-02, where a unique index on
  // contributions.paystack_ref silently rejected every day after the first in
  // a multi-day settlement. v26 removed that constraint and v27 reconciled the
  // historical damage with a full audit trail, so the tool is obsolete.
  //
  // Its body moved money OUTSIDE settle_payment(): a blanket batch UPDATE and
  // direct `status='paid'` writes, with no allocation ledger and no atomicity.
  // Phase 04 left that code behind an unconditional `return`. Dead financial
  // code one deleted line away from running again is a liability, not
  // documentation, so it is now gone. See docs/phase-03/financial-reconciliation.md.
  return error(
    'This repair tool has been removed. Settlement runs through the canonical ' +
    'transactional engine, which makes the defect it corrected impossible.', 410)
})
