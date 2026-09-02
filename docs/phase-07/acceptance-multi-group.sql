-- ============================================================================
-- §44 / §18 — MULTI-GROUP ACCEPTANCE, RUN AGAINST PRODUCTION AND ROLLED BACK
-- ============================================================================
-- A member in five groups pays GHS 450 into Group A. Group A must advance five
-- days; B, C, D and E must not move at all. Then GHS 50 completes the fifth
-- day. Credit stays scoped to the membership that earned it.
--
-- This runs the REAL engine — settle_payment() — against the REAL production
-- database, inside a transaction that is rolled back. Nothing survives it: no
-- member, no payment, no contribution, no log row. That is the only way to
-- test the deployed engine rather than a copy of it.
--
--   cat this | psql.sh        (returns one row per assertion)
-- ============================================================================
BEGIN;

CREATE TEMP TABLE t(ord serial, check_name text, expected text, actual text);
CREATE TEMP TABLE ids(k text primary key, v uuid);

-- ── Five groups at five different daily amounts ─────────────────────────────
WITH g AS (
  INSERT INTO susu_groups (name, contribution_amount, contribution_frequency, cycle_days,
                           max_members, current_members, registration_fee, status, start_date,
                           cashout_amount)
  SELECT 'P07-'||x.tag, x.amt, 'daily', 30, 50, 0, 0, 'active', CURRENT_DATE - 1, x.amt * 29
  FROM (VALUES ('A',100.00),('B',150.00),('C',50.00),('D',200.00),('E',75.00)) AS x(tag,amt)
  RETURNING id, name),
m AS (
  INSERT INTO members (full_name, phone, ghana_card_number, status, member_id)
  VALUES ('P07 Acceptance Member', '+233555000999', 'GHA-P07-ACC', 'active', 'P07-ACC')
  RETURNING id),
gm AS (
  INSERT INTO group_memberships (member_id, group_id, payout_position, status, joined_at, slot_fraction)
  SELECT m.id, g.id, row_number() OVER (ORDER BY g.name), 'active', now(), 1 FROM m, g
  RETURNING id, group_id)
INSERT INTO ids(k,v)
SELECT 'member', id FROM m
UNION ALL SELECT 'gm_'||right(g.name,1), gm.id FROM gm JOIN g ON g.id = gm.group_id
UNION ALL SELECT 'grp_'||right(g.name,1), g.id FROM g;

-- ── Ten unpaid days on each membership, starting today ──────────────────────
INSERT INTO contributions (member_id, group_id, membership_id, amount, due_date, status, cycle_number, amount_paid)
SELECT (SELECT v FROM ids WHERE k='member'), gm.group_id, gm.id, g.contribution_amount,
       CURRENT_DATE + d, 'pending', 1, 0
FROM group_memberships gm
JOIN susu_groups g ON g.id = gm.group_id
CROSS JOIN generate_series(0, 9) d
WHERE gm.member_id = (SELECT v FROM ids WHERE k='member');

-- ── GHS 450 into GROUP A ONLY ───────────────────────────────────────────────
INSERT INTO transactions (member_id, type, amount, reference, status, related_id, paystack_data)
SELECT (SELECT v FROM ids WHERE k='member'), 'contribution', 450.00, 'P07-ACC-450', 'pending',
       (SELECT c.id FROM contributions c
         WHERE c.membership_id = (SELECT v FROM ids WHERE k='gm_A')
         ORDER BY c.due_date LIMIT 1),
       jsonb_build_object('scope','slot');

INSERT INTO t(check_name, expected, actual)
SELECT 'A: days settled by GHS 450', '4 full + 1 part',
       count(*) FILTER (WHERE o_kind='full')||' full + '||count(*) FILTER (WHERE o_kind='part')||' part'
FROM settle_payment('P07-ACC-450', 450.00, 'slot', CURRENT_DATE, NULL);

INSERT INTO t(check_name, expected, actual)
SELECT 'A: amounts covered, in order', '100,100,100,100,50',
       string_agg(c.amount_paid::numeric(10,0)::text, ',' ORDER BY c.due_date)
FROM contributions c
WHERE c.membership_id=(SELECT v FROM ids WHERE k='gm_A') AND c.amount_paid > 0;

INSERT INTO t(check_name, expected, actual)
SELECT 'A: paid total', '450.00', COALESCE(sum(amount_paid),0)::numeric(10,2)::text
FROM contributions WHERE membership_id=(SELECT v FROM ids WHERE k='gm_A');

-- ── §18: B, C, D, E must be untouched ───────────────────────────────────────
INSERT INTO t(check_name, expected, actual)
SELECT 'B/C/D/E: total paid', '0.00', COALESCE(sum(c.amount_paid),0)::numeric(10,2)::text
FROM contributions c
WHERE c.membership_id IN (SELECT v FROM ids WHERE k IN ('gm_B','gm_C','gm_D','gm_E'));

INSERT INTO t(check_name, expected, actual)
SELECT 'B/C/D/E: days marked paid', '0', count(*)::text
FROM contributions c
WHERE c.membership_id IN (SELECT v FROM ids WHERE k IN ('gm_B','gm_C','gm_D','gm_E'))
  AND c.status = 'paid';

INSERT INTO t(check_name, expected, actual)
SELECT 'B/C/D/E: allocations received', '0', count(*)::text
FROM payment_allocations pa
WHERE pa.membership_id IN (SELECT v FROM ids WHERE k IN ('gm_B','gm_C','gm_D','gm_E'));

-- ── A further GHS 50 completes day 5 ────────────────────────────────────────
INSERT INTO transactions (member_id, type, amount, reference, status, related_id, paystack_data)
SELECT (SELECT v FROM ids WHERE k='member'), 'contribution', 50.00, 'P07-ACC-50', 'pending',
       (SELECT c.id FROM contributions c
         WHERE c.membership_id=(SELECT v FROM ids WHERE k='gm_A') AND c.status<>'paid'
         ORDER BY c.due_date LIMIT 1),
       jsonb_build_object('scope','slot');
INSERT INTO t(check_name, expected, actual)
SELECT 'GHS 50 completes day 5', '1 full',
       count(*) FILTER (WHERE o_kind='full')||' full'
FROM settle_payment('P07-ACC-50', 50.00, 'slot', CURRENT_DATE, NULL);

INSERT INTO t(check_name, expected, actual)
SELECT 'A: five days now fully paid', '5', count(*)::text
FROM contributions WHERE membership_id=(SELECT v FROM ids WHERE k='gm_A') AND status='paid';

INSERT INTO t(check_name, expected, actual)
SELECT 'A: nothing part-paid left over', '0', count(*)::text
FROM contributions WHERE membership_id=(SELECT v FROM ids WHERE k='gm_A')
  AND status<>'paid' AND amount_paid > 0.005;

-- ── §22: payment history shows BOTH payments ────────────────────────────────
INSERT INTO t(check_name, expected, actual)
SELECT 'payment history: both payments listed', 'P07-ACC-450,P07-ACC-50',
       string_agg(DISTINCT pa.reference, ',' ORDER BY pa.reference)
FROM payment_allocations pa WHERE pa.member_id=(SELECT v FROM ids WHERE k='member');

-- ── §20: credit stays with the membership that earned it ────────────────────
INSERT INTO transactions (member_id, type, amount, reference, status, related_id, paystack_data)
SELECT (SELECT v FROM ids WHERE k='member'), 'contribution', 20.00, 'P07-ACC-CREDIT', 'pending',
       (SELECT c.id FROM contributions c
         WHERE c.membership_id=(SELECT v FROM ids WHERE k='gm_C') AND c.status<>'paid'
         ORDER BY c.due_date LIMIT 1),
       jsonb_build_object('scope','slot');
SELECT count(*) FROM settle_payment('P07-ACC-CREDIT', 20.00, 'slot', CURRENT_DATE, NULL);

INSERT INTO t(check_name, expected, actual)
SELECT 'C: 20 part-pays C''s first day', '20.00',
       COALESCE(max(amount_paid),0)::numeric(10,2)::text
FROM contributions WHERE membership_id=(SELECT v FROM ids WHERE k='gm_C');

INSERT INTO t(check_name, expected, actual)
SELECT 'A unaffected by C''s payment', '500.00', COALESCE(sum(amount_paid),0)::numeric(10,2)::text
FROM contributions WHERE membership_id=(SELECT v FROM ids WHERE k='gm_A');

-- ── §21: the statement's accounting identity must hold ──────────────────────
INSERT INTO t(check_name, expected, actual)
SELECT 'statement reconciles, all 5 groups', 'true',
       bool_and((ms->>'reconciles')::boolean)::text
FROM jsonb_array_elements(
       get_member_statement((SELECT v FROM ids WHERE k='member'),
                            CURRENT_DATE - 1, CURRENT_DATE + 10, NULL) -> 'memberships') ms;

INSERT INTO t(check_name, expected, actual)
SELECT 'statement lists all 5 memberships', '5',
       jsonb_array_length(get_member_statement((SELECT v FROM ids WHERE k='member'),
                          CURRENT_DATE - 1, CURRENT_DATE + 10, NULL) -> 'memberships')::text;

-- ── §23: cash-out reported honestly when unassigned ─────────────────────────
-- No payout position has been scheduled for these memberships, so the date
-- must come back NULL — the portal renders that as "Not yet assigned" rather
-- than inventing one. The AMOUNT is legitimately known: it is the group's
-- configured cash-out, which is not a guess.
INSERT INTO t(check_name, expected, actual)
SELECT 'cash-out date not fabricated', 'true',
       bool_and(ms->>'cash_out_date' IS NULL)::text
FROM jsonb_array_elements(
       get_member_statement((SELECT v FROM ids WHERE k='member'),
                            CURRENT_DATE - 1, CURRENT_DATE + 10, NULL) -> 'memberships') ms;

INSERT INTO t(check_name, expected, actual)
SELECT 'cash-out amount is the group''s configured figure', 'true',
       bool_and((ms->>'payout_amount')::numeric = g.cashout_amount)::text
FROM jsonb_array_elements(
       get_member_statement((SELECT v FROM ids WHERE k='member'),
                            CURRENT_DATE - 1, CURRENT_DATE + 10, NULL) -> 'memberships') ms
JOIN susu_groups g ON g.name = ms->>'group_name';

-- ── §38: the reversal must leave the ledger consistent ──────────────────────
INSERT INTO t(check_name, expected, actual)
SELECT 'reversal restores the day', 'true',
       (reverse_contribution_payment(
          (SELECT c.id FROM contributions c
            WHERE c.membership_id=(SELECT v FROM ids WHERE k='gm_A') AND c.status='paid'
            ORDER BY c.due_date LIMIT 1),
          NULL, 'P07 test', 'Acceptance test of the reversal path')->>'reversed');

INSERT INTO t(check_name, expected, actual)
SELECT 'reversal leaves no live allocation on an unpaid day', '0', count(*)::text
FROM payment_allocations pa JOIN contributions c ON c.id=pa.contribution_id
WHERE pa.member_id=(SELECT v FROM ids WHERE k='member')
  AND pa.reversed_at IS NULL AND c.status<>'paid' AND c.amount_paid < 0.005;

INSERT INTO t(check_name, expected, actual)
SELECT 'reversal preserved the allocation row', 'true',
       (count(*) FILTER (WHERE reversed_at IS NOT NULL) > 0)::text
FROM payment_allocations WHERE member_id=(SELECT v FROM ids WHERE k='member');

SELECT check_name, expected, actual,
       CASE WHEN expected = actual THEN 'PASS' ELSE 'FAIL' END AS verdict
FROM t ORDER BY ord;

ROLLBACK;
