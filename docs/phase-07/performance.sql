-- ============================================================================
-- §35 — DOES MEMBERSHIP COUNT EXPLODE THE QUERY COUNT?
-- ============================================================================
-- The portal and the statement are each ONE round trip, whatever a member
-- holds: `get_member_portal_state()` and `get_member_statement()` are single
-- RPCs that aggregate in the database. The failure mode this guards against is
-- the browser fetching per membership — 50 memberships, 50 requests — which is
-- what the dashboard did before Phase 04.
--
-- Run against production inside a rolled-back transaction.
-- ============================================================================
BEGIN;
CREATE TEMP TABLE perf(memberships int, portal_ms numeric, statement_ms numeric, days int);

DO $do$
DECLARE
  n        int;
  mid      uuid;
  gid      uuid;
  t0       timestamptz;
  p_ms     numeric;
  s_ms     numeric;
  n_days   int;
BEGIN
  FOREACH n IN ARRAY ARRAY[1, 5, 18, 30, 50] LOOP
    INSERT INTO members (full_name, phone, ghana_card_number, status, member_id)
    VALUES ('P07 Perf '||n, '+2335559'||lpad(n::text,5,'0'), 'GHA-PERF-'||n, 'active', 'PERF-'||n)
    RETURNING id INTO mid;

    FOR i IN 1..n LOOP
      INSERT INTO susu_groups (name, contribution_amount, contribution_frequency, cycle_days,
                               max_members, current_members, registration_fee, status, start_date, cashout_amount)
      VALUES ('P07-PERF-'||n||'-'||i, 50 + i, 'daily', 30, 60, 0, 0, 'active', CURRENT_DATE - 30, (50+i)*29)
      RETURNING id INTO gid;

      INSERT INTO group_memberships (member_id, group_id, payout_position, status, joined_at, slot_fraction)
      VALUES (mid, gid, i, 'active', now(), 1);

      -- 60 days each, so the largest case carries 3,000 obligations.
      INSERT INTO contributions (member_id, group_id, membership_id, amount, due_date, status, cycle_number, amount_paid)
      SELECT mid, gid, (SELECT id FROM group_memberships WHERE member_id=mid AND group_id=gid),
             50 + i, CURRENT_DATE - 30 + d,
             (CASE WHEN d < 20 THEN 'paid' ELSE 'pending' END)::contribution_status, 1,
             CASE WHEN d < 20 THEN 50 + i ELSE 0 END
      FROM generate_series(0, 59) d;
    END LOOP;

    SELECT count(*) INTO n_days FROM contributions WHERE member_id = mid;

    -- Without this the planner is working from statistics that predate every
    -- row above, and picks nested loops it would never pick in production.
    -- The first version of this test omitted it and reported 808ms at 50
    -- memberships; the real 30-membership member's statement takes 41ms. The
    -- test was measuring the absence of statistics, not the query.
    ANALYZE contributions;
    ANALYZE group_memberships;
    ANALYZE susu_groups;

    t0 := clock_timestamp();
    PERFORM get_member_portal_state(mid, CURRENT_DATE);
    p_ms := EXTRACT(epoch FROM clock_timestamp() - t0) * 1000;

    t0 := clock_timestamp();
    PERFORM get_member_statement(mid, CURRENT_DATE - 30, CURRENT_DATE, NULL);
    s_ms := EXTRACT(epoch FROM clock_timestamp() - t0) * 1000;

    INSERT INTO perf VALUES (n, round(p_ms, 1), round(s_ms, 1), n_days);
  END LOOP;
END
$do$;

SELECT memberships, days AS obligation_rows,
       portal_ms, statement_ms,
       round(portal_ms / NULLIF(memberships, 0), 2)    AS portal_ms_per_membership,
       round(statement_ms / NULLIF(memberships, 0), 2) AS statement_ms_per_membership
FROM perf ORDER BY memberships;
ROLLBACK;
