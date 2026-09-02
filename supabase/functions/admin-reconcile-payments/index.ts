import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'

/*
 * REMOVED IN PHASE 04, EMPTIED IN PHASE 07. Kept only as a 410 so any
 * bookmark, cron entry or stale console build gets a clear answer instead of
 * a 404 that looks like a deployment problem.
 *
 * What used to live here was a second settlement engine: it wrote
 * `status='paid'` straight onto contributions — including a blanket
 * `UPDATE ... WHERE batch_id = ...` — with no allocation ledger, no
 * `amount_paid`, no credit handling, no row locking and no atomicity. Two
 * engines cannot both be right about what a payment covered, and this one
 * wrote no record of what it had decided.
 *
 * The body was left in place in Phase 04 behind an unconditional `return`,
 * on the reasoning that it stayed readable. That was the wrong call: dead
 * financial code one deleted line away from running again is a liability, not
 * documentation. Its behaviour is described in docs/phase-04/PHASE-04-REPORT.md
 * and its replacement is `settle_payment()`.
 *
 * Reconciliation now lives in `admin-reconciliation`, which asks the provider
 * and settles through the canonical engine.
 */
serveWithCors(async (req) => {
  const c = handleCors(req)
  if (c) return c
  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  return error(
    'This tool has been removed. Reconciliation runs through admin-reconciliation, ' +
    'which asks the provider and settles through the canonical engine.', 410)
})

