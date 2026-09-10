-- ============================================================================
-- FRACTIONAL SLOTS — BUSINESS RULE SUITE
-- ============================================================================
-- Every row returned is a result. `FAIL` in the verdict column is a defect.
--
-- ── SAFE AGAINST PRODUCTION ─────────────────────────────────────────────────
-- Everything happens inside a transaction that ends in ROLLBACK. The fixture
-- groups, members and memberships never commit. It runs against the REAL
-- tables, the REAL triggers and the REAL placement function — a test against a
-- reimplementation of the rule proves only that it was reimplemented
-- consistently.
--
-- ── THE RULE UNDER TEST ─────────────────────────────────────────────────────
--   full = 4 quarter-shares, half = 2, quarter = 1; a turn holds exactly 4.
--   Slots sharing a turn share its number and its date, because there is one
--   turn and the turn owns both.
-- ============================================================================

BEGIN;

INSERT INTO susu_groups (name, contribution_amount, cashout_amount, max_members, cycle_days, status)
VALUES ('ZZ Rotation A', 10, 1000, 20, 5, 'open'), ('ZZ Rotation B', 10, 1000, 20, 5, 'open');

INSERT INTO members (full_name, phone, ghana_card_number)
SELECT 'ZZ Member ' || n, '0209000' || lpad(n::text,3,'0'), 'ZZ-CARD-' || lpad(n::text,3,'0')
FROM generate_series(1,12) n;

CREATE TEMP VIEW gA AS SELECT id FROM susu_groups WHERE name='ZZ Rotation A';
CREATE TEMP VIEW gB AS SELECT id FROM susu_groups WHERE name='ZZ Rotation B';

-- Place a slot exactly the way the application does: ask the placement rule for
-- a turn, then insert the membership onto it.
CREATE FUNCTION pg_temp.place(p_group uuid, p_n int, p_frac numeric)
RETURNS uuid LANGUAGE plpgsql AS $fn$
DECLARE v_unit uuid; v_id uuid; v_member uuid;
BEGIN
  SELECT id INTO v_member FROM members WHERE ghana_card_number = 'ZZ-CARD-' || lpad(p_n::text,3,'0');
  v_unit := place_in_payout_unit(p_group,
              CASE p_frac WHEN 1 THEN 4 WHEN 0.5 THEN 2 WHEN 0.25 THEN 1 END);
  INSERT INTO group_memberships (member_id, group_id, payout_position, status,
                                 slot_fraction, payout_unit_id)
  VALUES (v_member, p_group, 1, 'active', p_frac, v_unit)
  RETURNING id INTO v_id;
  RETURN v_id;
END $fn$;

-- How many distinct turns, and how many distinct dates, a set of slots holds.
CREATE FUNCTION pg_temp.turns(p_ids uuid[])
RETURNS TABLE(units bigint, numbers bigint, dates bigint) LANGUAGE sql AS $fn$
  SELECT count(DISTINCT payout_unit_id), count(DISTINCT payout_position),
         count(DISTINCT payout_date)
  FROM group_memberships WHERE id = ANY(p_ids);
$fn$;

CREATE TEMP TABLE r(ord int, scenario text, ok boolean);

-- ── TEST 1 — one full slot is one turn ─────────────────────────────────────
DO $t$
DECLARE a uuid; g uuid;
BEGIN
  SELECT id INTO g FROM gA;
  a := pg_temp.place(g, 1, 1);
  INSERT INTO r VALUES (1, 'One full slot occupies exactly one turn, filled 4/4',
    (SELECT count(*) = 1 AND max(slot_quarters) = 4
     FROM group_memberships WHERE id = a)
    AND (SELECT sum(slot_quarters) = 4 FROM group_memberships gm
         WHERE gm.payout_unit_id = (SELECT payout_unit_id FROM group_memberships WHERE id=a)));
END $t$;

-- ── TEST 2 — half + half in one group is ONE turn ──────────────────────────
DO $t$
DECLARE a uuid; b uuid; g uuid; t record;
BEGIN
  SELECT id INTO g FROM gA;
  a := pg_temp.place(g, 2, 0.5);
  b := pg_temp.place(g, 3, 0.5);
  UPDATE payout_units SET payout_date = DATE '2026-09-15'
   WHERE id = (SELECT payout_unit_id FROM group_memberships WHERE id=a);
  SELECT * INTO t FROM pg_temp.turns(ARRAY[a,b]);
  INSERT INTO r VALUES (2, 'Half + half share one turn, one number and one date',
    t.units = 1 AND t.numbers = 1 AND t.dates = 1);
  INSERT INTO r VALUES (21, 'Both halves carry the date set on the turn (15 Sep 2026)',
    (SELECT count(*) = 2 FROM group_memberships
      WHERE id = ANY(ARRAY[a,b]) AND payout_date = DATE '2026-09-15'));
END $t$;

-- ── TEST 3 — four quarters is ONE turn ─────────────────────────────────────
DO $t$
DECLARE ids uuid[]; g uuid; t record; i int;
BEGIN
  SELECT id INTO g FROM gA;
  FOR i IN 4..7 LOOP ids := ids || pg_temp.place(g, i, 0.25); END LOOP;
  UPDATE payout_units SET payout_date = DATE '2026-09-18'
   WHERE id = (SELECT payout_unit_id FROM group_memberships WHERE id = ids[1]);
  SELECT * INTO t FROM pg_temp.turns(ids);
  INSERT INTO r VALUES (3, 'Four quarters share one turn, one number and one date',
    t.units = 1 AND t.numbers = 1 AND t.dates = 1);
  INSERT INTO r VALUES (31, 'All four quarters carry the turn date (18 Sep 2026)',
    (SELECT count(*) = 4 FROM group_memberships
      WHERE id = ANY(ids) AND payout_date = DATE '2026-09-18'));
END $t$;

-- ── TEST 4 — two quarters is half a turn, not a turn ───────────────────────
DO $t$
DECLARE a uuid; b uuid; g uuid; q int;
BEGIN
  SELECT id INTO g FROM gB;
  a := pg_temp.place(g, 8, 0.25);
  b := pg_temp.place(g, 9, 0.25);
  SELECT sum(slot_quarters) INTO q FROM group_memberships
   WHERE payout_unit_id = (SELECT payout_unit_id FROM group_memberships WHERE id=a);
  INSERT INTO r VALUES (4, 'Two quarters fill 2/4 — a turn, not yet a full one', q = 2);
END $t$;

-- ── TEST 5 — three quarters is still not a full turn ───────────────────────
DO $t$
DECLARE c uuid; g uuid; q int;
BEGIN
  SELECT id INTO g FROM gB;
  c := pg_temp.place(g, 10, 0.25);
  SELECT sum(slot_quarters) INTO q FROM group_memberships
   WHERE payout_unit_id = (SELECT payout_unit_id FROM group_memberships WHERE id=c);
  INSERT INTO r VALUES (5, 'Three quarters fill 3/4 — still not a full turn', q = 3);
END $t$;

-- ── TEST 6 — half + quarter + quarter completes a turn ─────────────────────
DO $t$
DECLARE h uuid; q1 uuid; q2 uuid; g uuid; t record; q int;
BEGIN
  INSERT INTO susu_groups (name, contribution_amount, cashout_amount, max_members, cycle_days, status)
  VALUES ('ZZ Rotation C', 10, 1000, 20, 5, 'open');
  SELECT id INTO g FROM susu_groups WHERE name='ZZ Rotation C';
  h  := pg_temp.place(g, 11, 0.5);
  q1 := pg_temp.place(g, 12, 0.25);
  q2 := pg_temp.place(g, 1,  0.25);
  SELECT * INTO t FROM pg_temp.turns(ARRAY[h,q1,q2]);
  SELECT sum(slot_quarters) INTO q FROM group_memberships
   WHERE payout_unit_id = (SELECT payout_unit_id FROM group_memberships WHERE id=h);
  INSERT INTO r VALUES (6, 'Half + quarter + quarter make one full turn together',
    t.units = 1 AND t.numbers = 1 AND q = 4);
END $t$;

-- ── TEST 7 — groups are separate rotation contexts ─────────────────────────
DO $t$
DECLARE a uuid; b uuid; ga uuid; gb uuid; t record;
BEGIN
  INSERT INTO susu_groups (name, contribution_amount, cashout_amount, max_members, cycle_days, status)
  VALUES ('ZZ Rotation D', 10, 1000, 20, 5, 'open'), ('ZZ Rotation E', 10, 1000, 20, 5, 'open');
  SELECT id INTO ga FROM susu_groups WHERE name='ZZ Rotation D';
  SELECT id INTO gb FROM susu_groups WHERE name='ZZ Rotation E';
  a := pg_temp.place(ga, 2, 0.5);
  b := pg_temp.place(gb, 3, 0.5);
  SELECT * INTO t FROM pg_temp.turns(ARRAY[a,b]);
  INSERT INTO r VALUES (7, 'A half in one group never joins a half in another',
    t.units = 2
    AND (SELECT count(DISTINCT pu.group_id) = 2 FROM payout_units pu
         JOIN group_memberships gm ON gm.payout_unit_id = pu.id
         WHERE gm.id = ANY(ARRAY[a,b])));
END $t$;

-- ── TEST 8 — halves joining at different times still share the turn ────────
DO $t$
DECLARE a uuid; b uuid; g uuid; t record;
BEGIN
  INSERT INTO susu_groups (name, contribution_amount, cashout_amount, max_members, cycle_days, status)
  VALUES ('ZZ Rotation F', 10, 1000, 20, 5, 'open');
  SELECT id INTO g FROM susu_groups WHERE name='ZZ Rotation F';
  a := pg_temp.place(g, 4, 0.5);
  UPDATE payout_units SET payout_date = DATE '2026-10-01'
   WHERE id = (SELECT payout_unit_id FROM group_memberships WHERE id=a);
  -- ... time passes, a date is already set, then the second half arrives ...
  b := pg_temp.place(g, 5, 0.5);
  SELECT * INTO t FROM pg_temp.turns(ARRAY[a,b]);
  INSERT INTO r VALUES (8, 'A half added later joins the waiting half''s turn and date',
    t.units = 1 AND t.numbers = 1 AND t.dates = 1
    AND (SELECT payout_date = DATE '2026-10-01' FROM group_memberships WHERE id=b));
END $t$;

-- ── TEST 9 — four quarters added at different times ────────────────────────
DO $t$
DECLARE ids uuid[]; g uuid; t record; i int;
BEGIN
  INSERT INTO susu_groups (name, contribution_amount, cashout_amount, max_members, cycle_days, status)
  VALUES ('ZZ Rotation G', 10, 1000, 20, 5, 'open');
  SELECT id INTO g FROM susu_groups WHERE name='ZZ Rotation G';
  FOR i IN 6..9 LOOP
    ids := ids || pg_temp.place(g, i, 0.25);
    UPDATE payout_units SET payout_date = DATE '2026-11-11'
     WHERE id = (SELECT payout_unit_id FROM group_memberships WHERE id = ids[1]);
  END LOOP;
  SELECT * INTO t FROM pg_temp.turns(ids);
  INSERT INTO r VALUES (9, 'Four quarters arriving separately end on one turn and date',
    t.units = 1 AND t.numbers = 1 AND t.dates = 1);
END $t$;

-- ── TEST 12 — a fifth quarter cannot squeeze into a full turn ──────────────
DO $t$
DECLARE g uuid; unit_no int; failed boolean := false;
BEGIN
  SELECT id INTO g FROM susu_groups WHERE name='ZZ Rotation G';
  SELECT pu.unit_number INTO unit_no FROM payout_units pu
   JOIN group_memberships gm ON gm.payout_unit_id = pu.id
   WHERE pu.group_id = g GROUP BY pu.unit_number HAVING sum(gm.slot_quarters) = 4 LIMIT 1;
  BEGIN
    PERFORM assign_membership_to_unit(pg_temp.place(g, 10, 0.25), unit_no);
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  INSERT INTO r VALUES (12, 'A turn already at 4/4 refuses a fifth quarter', failed);
END $t$;

-- ── TEST 13 — a half cannot be paired onto a full slot (the v16 gap) ───────
DO $t$
DECLARE g uuid; full_no int; h uuid; failed boolean := false;
BEGIN
  INSERT INTO susu_groups (name, contribution_amount, cashout_amount, max_members, cycle_days, status)
  VALUES ('ZZ Rotation H', 10, 1000, 20, 5, 'open');
  SELECT id INTO g FROM susu_groups WHERE name='ZZ Rotation H';
  PERFORM pg_temp.place(g, 11, 1);
  SELECT pu.unit_number INTO full_no FROM payout_units pu WHERE pu.group_id = g LIMIT 1;
  h := pg_temp.place(g, 12, 0.5);
  BEGIN
    PERFORM assign_membership_to_unit(h, full_no);
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  INSERT INTO r VALUES (13, 'A half cannot be paired onto a full slot (1.5 turns is refused)', failed);
END $t$;

-- ── TEST 14 — a slot that has collected cannot be moved ────────────────────
DO $t$
DECLARE g uuid; a uuid; failed boolean := false;
BEGIN
  INSERT INTO susu_groups (name, contribution_amount, cashout_amount, max_members, cycle_days, status)
  VALUES ('ZZ Rotation I', 10, 1000, 20, 5, 'open');
  SELECT id INTO g FROM susu_groups WHERE name='ZZ Rotation I';
  a := pg_temp.place(g, 1, 0.5);
  UPDATE group_memberships SET payout_received = true WHERE id = a;
  BEGIN
    PERFORM assign_membership_to_unit(a, 99);
  EXCEPTION WHEN check_violation THEN failed := true;
  END;
  INSERT INTO r VALUES (14, 'A slot that has already collected refuses to be moved', failed);
END $t$;

-- ── TEST 15 — the turn owns the date: change it once, everyone moves ───────
DO $t$
DECLARE a uuid; b uuid; g uuid;
BEGIN
  INSERT INTO susu_groups (name, contribution_amount, cashout_amount, max_members, cycle_days, status)
  VALUES ('ZZ Rotation J', 10, 1000, 20, 5, 'open');
  SELECT id INTO g FROM susu_groups WHERE name='ZZ Rotation J';
  a := pg_temp.place(g, 2, 0.5);
  b := pg_temp.place(g, 3, 0.5);
  -- An administrator edits ONE membership, the way the existing admin screen does.
  UPDATE group_memberships SET payout_date = DATE '2026-12-25' WHERE id = a;
  INSERT INTO r VALUES (15, 'Editing one member''s date moves everyone sharing that turn',
    (SELECT count(*) = 2 FROM group_memberships
      WHERE id = ANY(ARRAY[a,b]) AND payout_date = DATE '2026-12-25'));
END $t$;

-- ── TEST 10/11 — the member portal: own turn, and next turn without leakage ─
DO $t$
DECLARE a uuid; b uuid; g uuid; mid uuid; payload jsonb;
BEGIN
  INSERT INTO susu_groups (name, contribution_amount, cashout_amount, max_members, cycle_days, status)
  VALUES ('ZZ Rotation K', 10, 1000, 20, 5, 'open');
  SELECT id INTO g FROM susu_groups WHERE name='ZZ Rotation K';
  a := pg_temp.place(g, 4, 0.5);
  b := pg_temp.place(g, 5, 0.5);
  PERFORM pg_temp.place(g, 6, 1);
  UPDATE payout_units SET payout_date = CURRENT_DATE + 30
   WHERE id = (SELECT payout_unit_id FROM group_memberships WHERE id=a);
  UPDATE payout_units SET payout_date = CURRENT_DATE + 10
   WHERE id = (SELECT payout_unit_id FROM group_memberships
               WHERE group_id=g AND slot_fraction=1 LIMIT 1);
  UPDATE group_memberships SET payout_amount = 5000 WHERE id = a;
  UPDATE group_memberships SET payout_amount = 6000 WHERE id = b;

  SELECT member_id INTO mid FROM group_memberships WHERE id = a;
  payload := get_member_rotation(mid, a);

  INSERT INTO r VALUES (10, 'The member sees their own turn, date and share',
    (payload->'mine'->>'position')::int = (SELECT payout_position FROM group_memberships WHERE id=a)
    AND (payload->'mine'->>'date')::date = CURRENT_DATE + 30
    AND (payload->'mine'->>'amount')::numeric = 5000
    AND (payload->'mine'->>'share_label') = 'Half slot'
    AND (payload->'mine'->>'shares_turn')::boolean);

  INSERT INTO r VALUES (11, 'The next turn shows position and date, and nothing about who holds it',
    (payload->'next'->>'date')::date = CURRENT_DATE + 10
    AND (payload->'next'->>'amount') IS NULL
    AND payload::text !~* '(full_name|"phone"|"email"|ghana_card|ZZ Member)');

  INSERT INTO r VALUES (16, 'The partner''s payout amount is nowhere in the payload',
    payload::text NOT LIKE '%6000%');

  INSERT INTO r VALUES (17, 'A shared turn is ONE row in the rotation list, not two',
    (SELECT count(*) FROM jsonb_array_elements(payload->'upcoming') u
      WHERE (u->>'position')::int = (payload->'mine'->>'position')::int) = 1);
END $t$;

SELECT ord, scenario, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS verdict
FROM r ORDER BY ord;

ROLLBACK;
