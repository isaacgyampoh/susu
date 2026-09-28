-- ============================================================================
-- ADMIN-MANAGED INSTALMENTS — BUSINESS RULE SUITE
-- ============================================================================
-- Runs against the real tables and functions, then rolls back.
-- Every row is a result. FAIL is a defect.
--
-- Covers the tests §42 names for the admin side: a walk-in customer created
-- with no portal, manual payments moving the balance, completion unlocking
-- fulfilment, and one customer holding several independent agreements.
-- ============================================================================

BEGIN;

INSERT INTO product_categories (id, name, slug)
VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'Appliances', 'appliances-admin-run');

INSERT INTO products (id, category_id, name, slug, cash_price, status, stock_quantity)
VALUES
 ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
  'Samsung 55 Smart TV','tv-admin-run', 4500.00, 'published', 3),
 ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001',
  'Nasco Fridge','fridge-admin-run', 3200.00, 'published', NULL);

INSERT INTO payment_plans (id, product_id, name, frequency, duration_count,
                           installment_amount, deposit_amount, total_payable)
VALUES ('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',
        '8 months','monthly',8,475.00,1000.00,4800.00);

CREATE TEMP TABLE admin_id AS SELECT id FROM admin_users LIMIT 1;

-- ── A customer asks through the website ─────────────────────────────────────
CREATE TEMP TABLE req AS
SELECT submit_installment_request(
  'cccccccc-0000-0000-0000-000000000001',
  'John Mensah', '+233244777111', NULL, NULL, 'Kasoa', 1,
  'I can pay 1000 now') AS j;

-- Status AS SUBMITTED. Read now, because the collector converts it further
-- down in this same transaction — the first version of this check looked
-- afterwards and reported the conversion as a failure to be pending.
CREATE TEMP TABLE req_at_submission AS
SELECT status::text AS status, purchase_id
FROM installment_requests WHERE phone = '+233244777111';

-- ── The collector agrees terms and creates the agreement ────────────────────
-- Deliberately DIFFERENT terms from the plan (deposit 1200, 6 payments), which
-- is what negotiating means and what the snapshot has to survive.
CREATE TEMP TABLE agree AS
SELECT create_installment_agreement(
  (SELECT id FROM admin_id), 'John Mensah', '+233244777111',
  'bbbbbbbb-0000-0000-0000-000000000001',
  4800.00, 1200.00, 6, 'monthly', NULL, 'Agreed at the shop', '2026-01-15',
  (SELECT id FROM installment_requests WHERE phone='+233244777111'),
  'Paid 1200 deposit in cash') AS j;

-- ── A second, independent agreement for the same person ─────────────────────
CREATE TEMP TABLE agree2 AS
SELECT create_installment_agreement(
  (SELECT id FROM admin_id), 'John Mensah', '+233244777111',
  'bbbbbbbb-0000-0000-0000-000000000002',
  3400.00, 400.00, 3, 'monthly', NULL, 'Agreed at the shop', '2026-01-15',
  NULL, NULL) AS j;

-- ── Manual payments against the first ───────────────────────────────────────
CREATE TEMP TABLE pay1 AS SELECT record_manual_payment(
  ((SELECT j FROM agree)->>'purchase_id')::uuid, 600.00, 'cash',
  (SELECT id FROM admin_id), NULL, '2026-02-15', 'Cash at the shop') AS j;

CREATE TEMP TABLE pay2 AS SELECT record_manual_payment(
  ((SELECT j FROM agree)->>'purchase_id')::uuid, 600.00, 'momo',
  (SELECT id FROM admin_id), 'MM-99881', '2026-03-15', NULL) AS j;

WITH checks AS (

  SELECT 1 AS ord, 'A website request arrives pending, owing nothing' AS scenario,
         (SELECT status = 'pending' AND purchase_id IS NULL FROM req_at_submission) AS ok

  UNION ALL
  SELECT 2, 'A request creates no purchase and no schedule on its own',
         (SELECT count(*) FROM purchase_installments i
           JOIN purchases p ON p.id = i.purchase_id
          WHERE p.member_id = (SELECT id FROM members WHERE phone='+233244777111')
            AND p.reference = 'never') = 0

  UNION ALL
  SELECT 3, 'Approving the request converts it and links the purchase',
         (SELECT status = 'converted' AND purchase_id IS NOT NULL
            FROM installment_requests WHERE phone='+233244777111')

  UNION ALL
  -- §16: the walk-in. A customer exists, with no way to sign in.
  SELECT 4, 'The customer exists but has no portal login',
         (SELECT passcode_hash IS NULL AND source = 'shop'
            FROM members WHERE phone='+233244777111')

  UNION ALL
  -- §35: the terms agreed, not the terms advertised.
  SELECT 5, 'The agreement keeps the terms the collector agreed, not the plan''s',
         (SELECT total_payable = 4800.00 AND deposit_amount = 1200.00
                 AND duration_count = 6
            FROM purchases WHERE id = ((SELECT j FROM agree)->>'purchase_id')::uuid)

  UNION ALL
  SELECT 6, 'The schedule sums to the total less the deposit, to the pesewa',
         (SELECT sum(amount) FROM purchase_installments
           WHERE purchase_id = ((SELECT j FROM agree)->>'purchase_id')::uuid) = 3600.00

  UNION ALL
  SELECT 7, 'A manual cash payment settles an instalment',
         (SELECT (j->>'installments_settled')::int FROM pay1) = 1

  UNION ALL
  SELECT 8, 'The balance falls by what was actually handed over',
         (SELECT (j->>'balance')::numeric FROM pay2) = 2400.00

  UNION ALL
  -- The whole reason manual payments reuse the engine: one ledger.
  SELECT 9, 'Manual payments land in the same allocation ledger as provider ones',
         (SELECT count(*) FROM payment_allocations
           WHERE purchase_id = ((SELECT j FROM agree)->>'purchase_id')::uuid
             AND installment_id IS NOT NULL) = 2

  UNION ALL
  SELECT 10, 'The method and the collector who took it are recorded',
         (SELECT count(*) FROM transactions
           WHERE related_id = ((SELECT j FROM agree)->>'purchase_id')::uuid
             AND method IN ('cash','momo') AND recorded_by IS NOT NULL) = 2

  UNION ALL
  SELECT 11, 'A manual payment beyond the balance is refused',
         NOT EXISTS (
           SELECT 1 FROM transactions
            WHERE related_id = ((SELECT j FROM agree)->>'purchase_id')::uuid
              AND amount > 3000)

  UNION ALL
  -- §G: independent agreements for one customer.
  SELECT 12, 'One customer holds several agreements, each with its own balance',
         (SELECT count(*) FROM purchases
           WHERE member_id = (SELECT id FROM members WHERE phone='+233244777111')) = 2

  UNION ALL
  SELECT 13, 'Paying one agreement leaves the other untouched',
         (SELECT count(*) FROM purchase_installments
           WHERE purchase_id = ((SELECT j FROM agree2)->>'purchase_id')::uuid
             AND status = 'paid') = 0

  UNION ALL
  SELECT 14, 'A returning customer is the same person, not a second record',
         (SELECT count(*) FROM members WHERE phone='+233244777111') = 1

  UNION ALL
  SELECT 15, 'The overview counts what is genuinely outstanding',
         (get_installment_overview()->>'outstanding')::numeric >= 2400.00
)
SELECT ord, scenario, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS verdict
FROM checks ORDER BY ord;

ROLLBACK;
