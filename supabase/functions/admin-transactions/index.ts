import { handleCors, json, serveWithCors } from '../_shared/cors.ts'

/**
 * ADMIN TRANSACTIONS — SUPERSEDED BY `admin-payments`.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Kept as a 410 so any bookmark, stale console build or half-finished script
 * gets a clear answer instead of a 404 that reads like a broken deployment.
 * That is the same treatment `admin-reconcile-payments` and `moolre-webhook`
 * already have.
 *
 * ── WHY IT WAS REPLACED, AND WHY THE BODY IS GONE ───────────────────────
 *
 * It paginated FIRST and then filtered the page in JavaScript:
 *
 *     const { data, count } = await q.range((page - 1) * size, page * size - 1)
 *     const filtered = channel === 'all' ? rows : rows.filter(r => r.channel === channel)
 *
 * So "manual payments, page 1" returned however many of the newest fifty
 * happened to be manual — sometimes three rows — while the pager beside them
 * was computed from the UNFILTERED count and insisted there were more pages.
 * Filtering after paging cannot be corrected in the caller; it has to happen in
 * the query that chooses the rows.
 *
 * `admin-payments` does the filtering, counting and totalling in one pass, so
 * its summary can never describe a different population than its list.
 *
 * Leaving the old body deployed would have left a working-looking endpoint that
 * quietly returns wrong pages to whoever finds it next. An explicit 410 is the
 * honest answer.
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  return json({
    error: 'This endpoint has been replaced by admin-payments.',
    replacement: 'admin-payments',
    reason: 'It filtered results after pagination, so filtered pages and their page counts disagreed.',
  }, 410, req)
})
