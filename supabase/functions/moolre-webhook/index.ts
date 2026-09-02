import { handleCors, json, serveWithCors } from '../_shared/cors.ts'

/**
 * MOOLRE CALLBACK — REMOVED IN PHASE 07.
 *
 * ────────────────────────────────────────────────────────────────────────
 * WHAT THIS WAS, AND WHY IT HAD TO GO
 *
 * Moolre was dropped when the business settled on NaloPay. The code went out
 * of the repository; the FUNCTION stayed deployed. It was still ACTIVE, still
 * `verify_jwt = false` — so callable by anyone, from anywhere — and it still
 * wrote `contributions.status = 'paid'` and `transactions.status = 'success'`
 * directly, outside the canonical settlement engine and without writing an
 * allocation row.
 *
 * That is three problems in one endpoint: a duplicate financial engine, an
 * unauthenticated writer of financial state, and a settlement path that left
 * no record of what it had decided.
 *
 * Phase 05's function audit missed it because that audit read the repository,
 * and this had no source in the repository to read — the deployment had
 * drifted from version control. The lesson is the fix: it is emptied rather
 * than deleted, and it now lives in git, so deployment and repository agree.
 *
 * It had never settled anything. No transaction in production carries a
 * Moolre reference, and no row anywhere records this endpoint acting.
 * ────────────────────────────────────────────────────────────────────────
 */
serveWithCors(async (req) => {
  const c = handleCors(req)
  if (c) return c

  console.warn('moolre-webhook: called after removal — Moolre is not a payment provider here')
  return json({
    received: false,
    error: 'gone',
    message: 'Moolre is not a payment provider for this platform. Nothing was recorded.',
  }, 410)
})
