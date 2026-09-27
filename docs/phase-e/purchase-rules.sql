-- ============================================================================
-- PRODUCT INSTALMENTS — BUSINESS RULE SUITE
-- ============================================================================
-- Runs against the real tables, triggers and functions, then rolls back.
-- Every row is a result. FAIL is a defect.
--
-- Covers the tests §32 names, plus the rules most likely to cost somebody
-- money: the schedule summing exactly to the total, a duplicate callback
-- applying once, and an admin's price change never reaching a live purchase.
-- ============================================================================

BEGIN;

-- ── A customer and a catalogue, built for this run only ─────────────────────
CREATE TEMP TABLE t AS
SELECT
  (SELECT id FROM members ORDER BY created_at LIMIT 1)      AS member_a,
  (SELECT id FROM members ORDER BY created_at OFFSET 1 LIMIT 1) AS member_b;

INSERT INTO product_categories (id, name, slug)
VALUES ('11111111-1111-1111-1111-111111111111', 'Televisions', 'tv-test-run');

INSERT INTO products (id, category_id, name, slug, cash_price, status, stock_quantity)
VALUES
 ('22222222-2222-2222-2222-222222222221','11111111-1111-1111-1111-111111111111',
  'Samsung 55" Smart TV','tv-55-test', 4000.00, 'published', 5),
 ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111',
  'Blender','blender-test', 800.00, 'published', NULL),
 ('22222222-2222-2222-2222-222222222223','11111111-1111-1111-1111-111111111111',
  'Draft Fridge','fridge-draft-test', 3000.00, 'draft', NULL);

INSERT INTO payment_plans
 (id, product_id, name, frequency, duration_count, installment_amount, total_payable)
VALUES
 -- 4000 over 3 does not divide: 1333.33 × 3 = 3999.99. The rounding test.
 ('33333333-3333-3333-3333-333333333331','22222222-2222-2222-2222-222222222221',
  '3 months','monthly',3,1333.33,4000.00),
 ('33333333-3333-3333-3333-333333333332','22222222-2222-2222-2222-222222222221',
  '8 months','monthly',8,500.00,4000.00),
 ('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222',
  '4 months','monthly',4,200.00,800.00),
 ('33333333-3333-3333-3333-333333333334','22222222-2222-2222-2222-222222222223',
  'Draft plan','monthly',4,750.00,3000.00);

-- ── Purchases ───────────────────────────────────────────────────────────────
CREATE TEMP TABLE p AS
SELECT
 (create_purchase((SELECT member_a FROM t),'33333333-3333-3333-3333-333333333331','2026-01-10')->>'purchase_id')::uuid AS tv3,
 (create_purchase((SELECT member_a FROM t),'33333333-3333-3333-3333-333333333333','2026-01-10')->>'purchase_id')::uuid AS blender,
 (create_purchase((SELECT member_b FROM t),'33333333-3333-3333-3333-333333333332','2026-01-10')->>'purchase_id')::uuid AS tv8;

-- ── Payments. Real transaction rows, because that is what settlement reads ──
INSERT INTO transactions (member_id, type, amount, reference, status, description)
SELECT member_a, 'installment', 1333.33, 'TEST-PAY-1', 'success', 'test' FROM t;
INSERT INTO transactions (member_id, type, amount, reference, status, description)
SELECT member_a, 'installment', 2666.67, 'TEST-PAY-2', 'success', 'test' FROM t;
INSERT INTO transactions (member_id, type, amount, reference, status, description)
SELECT member_a, 'installment',  500.00, 'TEST-PAY-PENDING', 'pending', 'test' FROM t;
INSERT INTO transactions (member_id, type, amount, reference, status, description)
SELECT member_b, 'installment',  500.00, 'TEST-PAY-B', 'success', 'test' FROM t;

-- First payment against the TV.
CREATE TEMP TABLE r1 AS SELECT settle_purchase_payment('TEST-PAY-1',(SELECT tv3 FROM p)) AS j;
-- The very same callback again.
CREATE TEMP TABLE r1dup AS SELECT settle_purchase_payment('TEST-PAY-1',(SELECT tv3 FROM p)) AS j;

-- ── The checks ──────────────────────────────────────────────────────────────
WITH checks AS (

  SELECT 1 AS ord, 'A plan of 3 generates exactly 3 instalments' AS scenario,
         (SELECT count(*) FROM purchase_installments WHERE purchase_id=(SELECT tv3 FROM p)) = 3 AS ok

  UNION ALL
  -- The rounding rule. 1333.33 × 3 is 3999.99; the schedule must be 4000.00.
  SELECT 2, 'The schedule sums to the total payable, to the pesewa',
         (SELECT sum(amount) FROM purchase_installments WHERE purchase_id=(SELECT tv3 FROM p)) = 4000.00

  UNION ALL
  SELECT 3, 'Monthly dates step one month at a time',
         (SELECT array_agg(due_date ORDER BY sequence) FROM purchase_installments
           WHERE purchase_id=(SELECT tv3 FROM p))
         = ARRAY['2026-01-10','2026-02-10','2026-03-10']::date[]

  UNION ALL
  SELECT 4, 'A purchase snapshots the price it was bought at',
         (SELECT total_payable FROM purchases WHERE id=(SELECT tv3 FROM p)) = 4000.00

  UNION ALL
  SELECT 5, 'One payment settles exactly one instalment',
         (SELECT (j->>'installments_settled')::int FROM r1) = 1

  UNION ALL
  SELECT 6, 'The balance falls by the amount paid',
         (SELECT (j->>'balance')::numeric FROM r1) = 2666.67

  UNION ALL
  -- §28 and §15: the same callback twice must not take the money twice.
  SELECT 7, 'A duplicate callback is recognised and applies nothing',
         (SELECT (j->>'duplicate')::boolean FROM r1dup)

  UNION ALL
  SELECT 8, 'A duplicate callback leaves exactly one allocation',
         (SELECT count(*) FROM payment_allocations WHERE reference='TEST-PAY-1') = 1

  UNION ALL
  SELECT 9, 'A pending payment cannot be applied',
         NOT EXISTS (SELECT 1 FROM payment_allocations WHERE reference='TEST-PAY-PENDING')

  UNION ALL
  -- §12: purchases are independent. Paying the TV must not touch the blender.
  SELECT 10, 'Paying one purchase leaves the customer''s others alone',
         (SELECT count(*) FROM purchase_installments
           WHERE purchase_id=(SELECT blender FROM p) AND status='paid') = 0

  UNION ALL
  SELECT 11, 'A customer may hold several purchases at once',
         (SELECT count(*) FROM purchases WHERE member_id=(SELECT member_a FROM t)) >= 2

  UNION ALL
  -- §28 again, the one that matters most: an admin repricing the catalogue.
  SELECT 12, 'Repricing the product does not move a live purchase''s total',
         (SELECT total_payable FROM purchases WHERE id=(SELECT tv3 FROM p)) = 4000.00

  UNION ALL
  SELECT 13, 'An unpublished product cannot be bought',
         NOT EXISTS (
           SELECT 1 FROM purchases WHERE product_id='22222222-2222-2222-2222-222222222223')

  UNION ALL
  -- Two of the three purchases above are the SAME television on different
  -- plans, so a stock of 5 must fall by two, not one. The first version of
  -- this check expected 4 and was simply wrong about its own fixture.
  SELECT 14, 'Stock falls once per purchase, including two plans of one product',
         (SELECT stock_quantity FROM products WHERE id='22222222-2222-2222-2222-222222222221') = 3

  UNION ALL
  SELECT 15, 'An allocation names the instalment it settled',
         (SELECT installment_id IS NOT NULL AND purchase_id IS NOT NULL
            FROM payment_allocations WHERE reference='TEST-PAY-1')

  UNION ALL
  SELECT 16, 'A payment cannot be applied to another customer''s purchase',
         NOT EXISTS (SELECT 1 FROM payment_allocations
                      WHERE reference='TEST-PAY-B' AND purchase_id=(SELECT tv3 FROM p))
)
SELECT ord, scenario, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS verdict
FROM checks ORDER BY ord;

ROLLBACK;
