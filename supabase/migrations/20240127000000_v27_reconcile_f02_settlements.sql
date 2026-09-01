-- ============================================================================
-- V27 — RECONCILE THE SETTLEMENTS F-02 REJECTED  (Phase 03)
-- ============================================================================
-- v26 removed the constraint that was rejecting multi-day settlements. This
-- migration repairs the damage that constraint already did.
--
-- ── WHAT HAPPENED ────────────────────────────────────────────────────────
-- One member, SSU-0012, made three payments. All three reached us: their
-- transactions are status='success' and, for each, the sum of its allocation
-- rows EXACTLY equals the transaction amount — the allocator computed
-- correctly and accounted for every pesewa.
--
--   CONT-83a12989-…-1786633190831   GHS 350.00   6 allocations
--   CONT-c471eebc-…-1787739651236   GHS  56.00   2 allocations
--   CONT-d1a00c3b-…-1787738346459   GHS 195.00   3 allocations
--
-- But only the first day of each payment was actually written. The rest hit
-- 23505 on uniq_contribution_ref and settle.ts discarded the error.
--
-- The defect then COMPOUNDED. Because 2026-08-04 and 2026-08-05 stayed
-- 'pending', the member was billed for them again and paid again on 26 August
-- — so those two days now carry allocations from two different payments.
--
-- ── WHAT THIS MIGRATION DOES ─────────────────────────────────────────────
--   1. Marks paid only those days whose allocations demonstrably cover them
--      AND whose source payments are all status='success'.
--   2. Books the genuine duplicate payment as membership credit, so the money
--      is neither lost nor silently absorbed.
--   3. Backfills membership_id / due_date onto payment_allocations.
--   4. Writes an audit_log row for every change.
--
-- ── WHAT IT DELIBERATELY DOES NOT DO ─────────────────────────────────────
--   * It does not touch the one GENUINE partial (2026-08-07, GHS 25 of 65).
--     amount_paid already equals the allocation; that row is correct. The
--     partial path writes amount_paid without paystack_ref, so it never hit
--     the unique index.
--   * It does not invent an outcome for any payment that is not 'success'.
--   * It does not delete a single allocation row.
--
-- Idempotent: re-running changes nothing, because every write is guarded on
-- the state it is correcting.
-- ============================================================================

BEGIN;

-- The provable repair set, computed rather than hardcoded, and bounded by
-- three conditions that together mean "this day was paid for".
CREATE TEMP TABLE f02_repair ON COMMIT DROP AS
SELECT
  c.id                       AS contribution_id,
  c.membership_id,
  c.member_id,
  c.group_id,
  c.due_date,
  c.amount,
  c.penalty_due,
  a.allocated,
  a.refs,
  -- Money allocated beyond what this day actually costs: the duplicate payment.
  GREATEST(a.allocated - (c.amount + COALESCE(c.penalty_due,0)), 0) AS surplus,
  -- The reference that should be recorded against the day: the earliest, since
  -- that is the payment that genuinely settled it.
  a.first_ref
FROM contributions c
JOIN LATERAL (
  SELECT COALESCE(sum(pa.amount),0)                       AS allocated,
         array_agg(DISTINCT pa.reference)                 AS refs,
         (array_agg(pa.reference ORDER BY pa.created_at))[1] AS first_ref,
         bool_and(t.status = 'success')                   AS all_sources_succeeded
  FROM payment_allocations pa
  LEFT JOIN transactions t ON t.reference = pa.reference
  WHERE pa.contribution_id = c.id
) a ON true
WHERE c.status <> 'paid'
  AND a.allocated >= (c.amount + COALESCE(c.penalty_due,0)) - 0.005  -- fully covered
  AND a.all_sources_succeeded                                        -- money proven to have arrived
;

-- ── 1. Credit the days that were paid for ────────────────────────────────
UPDATE contributions c
SET status       = 'paid',
    paid_at      = COALESCE(c.paid_at, (
                     SELECT min(pa.created_at) FROM payment_allocations pa
                     WHERE pa.contribution_id = c.id)),
    amount_paid  = c.amount,
    paystack_ref = COALESCE(c.paystack_ref, r.first_ref)
FROM f02_repair r
WHERE c.id = r.contribution_id
  AND c.status <> 'paid';   -- idempotency guard

-- Settle any penalty attached to a day we have just credited.
UPDATE payment_penalties p
SET is_paid = true, paid_at = NOW()
FROM f02_repair r
WHERE p.contribution_id = r.contribution_id AND NOT p.is_paid;

-- ── 2. Book the duplicate payment as membership credit ───────────────────
-- The member paid twice for these days because the first settlement was
-- silently rejected. That money is real, it belongs to them, and it belongs
-- to THIS membership. It is booked to the ledger rather than applied to a
-- future obligation automatically: a corrective entry should be visible, and
-- the settlement engine will consume it on the member's next payment.
INSERT INTO membership_credit_ledger
  (membership_id, member_id, amount, entry_type, source_reference, contribution_id, note, created_by)
SELECT
  r.membership_id, r.member_id, r.surplus, 'reconciliation',
  r.refs[array_upper(r.refs,1)],
  r.contribution_id,
  'F-02 reconciliation (v27): day ' || r.due_date ||
  ' was allocated ' || r.allocated || ' against a cost of ' ||
  (r.amount + COALESCE(r.penalty_due,0)) ||
  '. The first settlement was rejected by uniq_contribution_ref, the day stayed unpaid, ' ||
  'and the member paid for it a second time. Surplus returned as membership credit.',
  'migration:v27'
FROM f02_repair r
WHERE r.surplus > 0.005
  AND NOT EXISTS (   -- idempotency guard
    SELECT 1 FROM membership_credit_ledger l
    WHERE l.contribution_id = r.contribution_id AND l.entry_type = 'reconciliation');

-- ── 3. Audit every change ────────────────────────────────────────────────
INSERT INTO audit_log (admin_id, admin_name, action, entity_type, entity_id, entity_label, details)
SELECT
  NULL, 'system:migration-v27', 'contribution.reconciled_f02', 'contribution',
  r.contribution_id,
  'Day ' || r.due_date || ' — GHS ' || r.amount,
  jsonb_build_object(
    'reason', 'Settlement was computed correctly but rejected by uniq_contribution_ref (F-02)',
    'allocated', r.allocated,
    'day_cost', r.amount + COALESCE(r.penalty_due,0),
    'surplus_returned_as_credit', r.surplus,
    'source_references', to_jsonb(r.refs),
    'membership_id', r.membership_id)
FROM f02_repair r;

-- ── 4. Backfill allocation provenance ────────────────────────────────────
-- v24 created these columns' worth of meaning but settle.ts only ever wrote
-- group_name, so an allocation could not be joined back to a slot or a day.
UPDATE payment_allocations pa
SET membership_id = c.membership_id,
    due_date      = c.due_date
FROM contributions c
WHERE pa.contribution_id = c.id
  AND (pa.membership_id IS NULL OR pa.due_date IS NULL);

COMMIT;

-- ============================================================================
-- VERIFICATION — must return zero rows after this migration.
--
--   SELECT count(*) FROM payment_allocations pa
--   JOIN contributions c ON c.id = pa.contribution_id
--   WHERE c.status <> 'paid'
--     AND (SELECT sum(amount) FROM payment_allocations x WHERE x.contribution_id=c.id)
--         >= c.amount + COALESCE(c.penalty_due,0) - 0.005;
--
-- The remaining allocation against an unpaid day should be exactly one: the
-- genuine partial on 2026-08-07 (GHS 25 of GHS 65), which is correct.
-- ============================================================================
