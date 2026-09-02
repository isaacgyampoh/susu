-- ============================================================================
-- "PAID SO FAR" — REGRESSION SUITE
-- ============================================================================
-- Locks the rule that settlement STATUS is authoritative and `amount_paid` only
-- refines an unsettled day. These tests fail if anyone reverts the reporting
-- expression to SUM(amount_paid).
--
-- Read-only: every case calls the pure function. Nothing is written, so this is
-- safe to run against production at any time.
-- ============================================================================

WITH cases(ord, scenario, status, amount, amount_paid, expected) AS (VALUES
  -- §19 — a day settled with its amount recorded.
  (1, 'Settled, amount recorded',              'paid',    100.00, 100.00, 100.00),

  -- §20 — THE LEGACY SHAPE. status='paid' with nothing recorded against it.
  --       2,895 production rows look like this. Reverting to SUM(amount_paid)
  --       makes this return 0 and this row fail.
  (2, 'Settled, legacy row with no amount',    'paid',    100.00,   0.00, 100.00),
  (3, 'Settled, legacy row with NULL amount',  'paid',    100.00,   NULL, 100.00),

  -- §18 — a genuine partial. Only what was paid counts, never the obligation.
  (4, 'Unsettled, part paid',                  'pending',  100.00,  40.00,  40.00),

  -- §17 — the opposite trap: money against an unsettled day must NOT promote
  --       the whole obligation to paid.
  (5, 'Unsettled, nearly paid',                'pending',  100.00,  99.99,  99.99),
  (6, 'Overdue, part paid',                    'overdue',  100.00,  25.00,  25.00),

  -- Nothing paid, nothing counted.
  (7, 'Unsettled, nothing paid',               'pending',  100.00,   0.00,   0.00),
  (8, 'Unsettled, NULL amount_paid',           'pending',  100.00,   NULL,   0.00),

  -- A settled day contributes its obligation, not an inflated figure, even if
  -- amount_paid was somehow recorded higher.
  (9, 'Settled, amount_paid overstated',       'paid',     100.00, 150.00, 100.00),

  -- An unsettled day can never contribute more than it costs.
  (10,'Unsettled, amount_paid exceeds amount', 'pending',  100.00, 150.00, 100.00)
)
SELECT
  ord,
  scenario,
  expected,
  contribution_settled_amount(status, amount, amount_paid) AS actual,
  CASE WHEN contribution_settled_amount(status, amount, amount_paid) = expected
       THEN 'PASS' ELSE 'FAIL' END AS verdict
FROM cases
ORDER BY ord;
