-- ============================================================================
-- PAYMENT SETTLEMENT — REGRESSION SUITE
-- ============================================================================
-- Runs the REAL engine (settle_payment) against synthetic data inside a
-- transaction that is rolled back. Nothing here touches production rows: the
-- member, group, membership and contributions are created and destroyed
-- within the same transaction.
--
-- Synthetic rather than borrowed production data, deliberately. A test that
-- picks "some member with unpaid days" passes or fails depending on what that
-- member happens to owe today, which makes a failure impossible to interpret.
--
-- Every row returned is a result. `FAIL` in the verdict column is a defect.
-- ============================================================================
BEGIN;

-- ── Fixture: two groups, one member, GHS 100/day ───────────────────────────
CREATE TEMP TABLE fx (k text PRIMARY KEY, v uuid);

WITH ins AS (
  INSERT INTO members (full_name, phone, ghana_card_number, status)
  VALUES ('ZZ Regression Probe', '+233000000199', 'GHA-TEST-REGRESSION', 'active')
  RETURNING id)
INSERT INTO fx SELECT 'member', id FROM ins;

WITH ins AS (
  INSERT INTO susu_groups (name, contribution_amount, max_members, status, cashout_amount)
  VALUES ('ZZ Probe Group A', 100, 20, 'active', 3000) RETURNING id)
INSERT INTO fx SELECT 'groupA', id FROM ins;

WITH ins AS (
  INSERT INTO susu_groups (name, contribution_amount, max_members, status, cashout_amount)
  VALUES ('ZZ Probe Group B', 100, 20, 'active', 3000) RETURNING id)
INSERT INTO fx SELECT 'groupB', id FROM ins;

WITH ins AS (
  INSERT INTO group_memberships (member_id, group_id, payout_position, status)
  SELECT (SELECT v FROM fx WHERE k='member'), (SELECT v FROM fx WHERE k='groupA'), 1, 'active'
  RETURNING id)
INSERT INTO fx SELECT 'memA', id FROM ins;

WITH ins AS (
  INSERT INTO group_memberships (member_id, group_id, payout_position, status)
  SELECT (SELECT v FROM fx WHERE k='member'), (SELECT v FROM fx WHERE k='groupB'), 1, 'active'
  RETURNING id)
INSERT INTO fx SELECT 'memB', id FROM ins;

-- Five unpaid days in each group, oldest first.
INSERT INTO contributions (member_id, group_id, membership_id, amount, due_date, status)
SELECT (SELECT v FROM fx WHERE k='member'), (SELECT v FROM fx WHERE k='groupA'),
       (SELECT v FROM fx WHERE k='memA'), 100, CURRENT_DATE - (5 - n), 'pending'
FROM generate_series(1,5) n;

INSERT INTO contributions (member_id, group_id, membership_id, amount, due_date, status)
SELECT (SELECT v FROM fx WHERE k='member'), (SELECT v FROM fx WHERE k='groupB'),
       (SELECT v FROM fx WHERE k='memB'), 100, CURRENT_DATE - (5 - n), 'pending'
FROM generate_series(1,5) n;

CREATE TEMP TABLE results (ord int, scenario text, expected text, actual text, verdict text);

-- ══ 1. GHS 450 against GHS 100/day → 100+100+100+100+50 ════════════════════
INSERT INTO transactions (member_id, type, amount, reference, status, related_id)
SELECT (SELECT v FROM fx WHERE k='member'), 'contribution', 450, 'ZZ-REG-450', 'pending',
       (SELECT id FROM contributions WHERE membership_id=(SELECT v FROM fx WHERE k='memA') ORDER BY due_date LIMIT 1);

CREATE TEMP TABLE r450 AS SELECT * FROM settle_payment('ZZ-REG-450', 450, 'slot');

INSERT INTO results
SELECT 1, 'GHS 450 spreads 100+100+100+100+50',
       '4 full + 1 part, 450 allocated',
       count(*) FILTER (WHERE kind='full') || ' full + ' ||
       count(*) FILTER (WHERE kind='part') || ' part, ' || COALESCE(sum(amount),0) || ' allocated',
       CASE WHEN count(*) FILTER (WHERE kind='full') = 4
             AND count(*) FILTER (WHERE kind='part') = 1
             AND sum(amount) = 450 THEN 'PASS' ELSE 'FAIL' END
FROM payment_allocations WHERE reference='ZZ-REG-450';

INSERT INTO results
SELECT 2, 'Part-paid day records 50 paid / 50 remaining',
       'amount_paid=50 and not settled',
       'amount_paid=' || c.amount_paid || ' status=' || c.status,
       CASE WHEN c.amount_paid = 50 AND c.status::text <> 'paid' THEN 'PASS' ELSE 'FAIL' END
FROM contributions c
JOIN payment_allocations pa ON pa.contribution_id = c.id
WHERE pa.reference='ZZ-REG-450' AND pa.kind='part';

-- ══ 2. IDEMPOTENCY — settling again must change nothing ════════════════════
CREATE TEMP TABLE r450b AS SELECT * FROM settle_payment('ZZ-REG-450', 450, 'slot');

INSERT INTO results
SELECT 3, 'Replaying the same payment allocates nothing extra',
       '5 allocations, 450 total',
       count(*) || ' allocations, ' || COALESCE(sum(amount),0) || ' total',
       CASE WHEN count(*) = 5 AND sum(amount) = 450 THEN 'PASS' ELSE 'FAIL' END
FROM payment_allocations WHERE reference='ZZ-REG-450';

-- ══ 3. GROUP ISOLATION — Group B must be untouched ═════════════════════════
INSERT INTO results
SELECT 4, 'A payment scoped to group A never touches group B',
       '0 paid days in B',
       count(*) || ' paid days in B',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM contributions
WHERE membership_id = (SELECT v FROM fx WHERE k='memB') AND COALESCE(amount_paid,0) > 0;

-- ══ 4. GHS 40 against a GHS 100 day → 40 paid, 60 remaining ════════════════
INSERT INTO transactions (member_id, type, amount, reference, status, related_id)
SELECT (SELECT v FROM fx WHERE k='member'), 'contribution', 40, 'ZZ-REG-40', 'pending',
       (SELECT id FROM contributions WHERE membership_id=(SELECT v FROM fx WHERE k='memB') ORDER BY due_date LIMIT 1);

CREATE TEMP TABLE r40 AS SELECT * FROM settle_payment('ZZ-REG-40', 40, 'slot');

INSERT INTO results
SELECT 5, 'GHS 40 against a GHS 100 day: 40 paid, 60 remaining',
       'paid=40 remaining=60, not settled',
       'paid=' || c.amount_paid || ' remaining=' || (c.amount - c.amount_paid) || ' status=' || c.status,
       CASE WHEN c.amount_paid = 40 AND (c.amount - c.amount_paid) = 60 AND c.status::text <> 'paid'
            THEN 'PASS' ELSE 'FAIL' END
FROM contributions c
JOIN payment_allocations pa ON pa.contribution_id = c.id
WHERE pa.reference='ZZ-REG-40';

-- ══ 5. A FAILED PAYMENT ALLOCATES NOTHING ══════════════════════════════════
INSERT INTO transactions (member_id, type, amount, reference, status, related_id)
SELECT (SELECT v FROM fx WHERE k='member'), 'contribution', 100, 'ZZ-REG-FAILED', 'failed',
       (SELECT id FROM contributions WHERE membership_id=(SELECT v FROM fx WHERE k='memB') ORDER BY due_date DESC LIMIT 1);

INSERT INTO results
SELECT 6, 'A failed payment has no allocations',
       '0 allocations',
       count(*) || ' allocations',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM payment_allocations WHERE reference='ZZ-REG-FAILED';

-- ══ 6. NO OBLIGATION MAY ABSORB MORE THAN IT COSTS ═════════════════════════
INSERT INTO results
SELECT 7, 'No contribution is overpaid by these settlements',
       '0 overpaid',
       count(*) || ' overpaid',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM contributions
WHERE member_id = (SELECT v FROM fx WHERE k='member') AND COALESCE(amount_paid,0) > amount + 0.005;

-- ══ 7. ALLOCATIONS NEVER EXCEED THE PAYMENT ════════════════════════════════
INSERT INTO results
SELECT 8, 'Allocations never exceed the payment that made them',
       '0 payments over-allocated',
       count(*) || ' over-allocated',
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END
FROM (SELECT pa.reference
      FROM payment_allocations pa JOIN transactions t ON t.reference = pa.reference
      WHERE pa.reference LIKE 'ZZ-REG-%' GROUP BY pa.reference
      HAVING sum(pa.amount) > max(t.amount) + 0.005) x;

SELECT ord, scenario, expected, actual, verdict FROM results ORDER BY ord;

ROLLBACK;
