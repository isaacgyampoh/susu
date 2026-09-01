-- ============================================================================
-- V29 — AGGREGATE IN THE DATABASE, NOT IN JAVASCRIPT  (Phase 03)
-- ============================================================================
-- Two read functions. Neither changes any data.
--
-- Both replace patterns that fetch rows over the wire and reduce() them in
-- JavaScript. That is wrong for three separate reasons here:
--
--   * It is unbounded. admin-dashboard SELECTs every successful transaction
--     with no LIMIT and sums it in the edge function. That query grows
--     forever and runs on every dashboard load.
--   * It is silently wrong. member-profile computes "Paid so far" from a
--     50-row window, so past day 50 the figure a member reads as their
--     lifetime contribution simply stops growing. For the member who belongs
--     to 18 groups, 50 rows is under three days each.
--   * It is an N+1. member-profile issues 6 fixed queries plus 2 per
--     membership. That member in 18 groups costs 42 round trips to open one
--     screen.
-- ============================================================================

BEGIN;

-- ── PART S — the whole member portal in one round trip ───────────────────
DROP FUNCTION IF EXISTS get_member_portal_state(UUID, DATE);

CREATE FUNCTION get_member_portal_state(p_member_id UUID, p_as_of DATE DEFAULT CURRENT_DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH ms AS (
    SELECT gm.id, gm.group_id, gm.payout_position, gm.payout_date, gm.payout_amount,
           gm.payout_received, gm.slot_fraction, gm.status,
           g.name AS group_name, g.contribution_amount, g.contribution_frequency,
           g.cycle_days, g.max_members, g.cashout_amount, g.payment_deadline
    FROM group_memberships gm
    JOIN susu_groups g ON g.id = gm.group_id
    WHERE gm.member_id = p_member_id AND gm.status = 'active'
  ),
  -- One pass over contributions produces every figure the portal needs.
  agg AS (
    SELECT c.membership_id,
           SUM(c.amount)                                                    AS total_expected,
           SUM(c.amount_paid)                                               AS total_paid,
           SUM(GREATEST(c.amount + COALESCE(c.penalty_due,0) - c.amount_paid, 0))
             FILTER (WHERE c.status <> 'paid')                              AS total_outstanding,
           SUM(GREATEST(c.amount + COALESCE(c.penalty_due,0) - c.amount_paid, 0))
             FILTER (WHERE c.status <> 'paid' AND c.due_date < p_as_of)     AS overdue,
           SUM(c.amount) FILTER (WHERE c.due_date = p_as_of)                AS due_today_total,
           SUM(c.amount_paid) FILTER (WHERE c.due_date = p_as_of)           AS paid_today,
           SUM(GREATEST(c.amount + COALESCE(c.penalty_due,0) - c.amount_paid, 0))
             FILTER (WHERE c.due_date = p_as_of AND c.status <> 'paid')     AS remaining_today,
           -- Money sitting against days that are not yet due: paid in advance.
           SUM(c.amount_paid) FILTER (WHERE c.due_date > p_as_of)           AS paid_in_advance,
           COUNT(*) FILTER (WHERE c.due_date > p_as_of AND c.status = 'paid') AS days_covered_ahead,
           COUNT(*)                                                         AS obligations,
           COUNT(*) FILTER (WHERE c.status = 'paid')                        AS obligations_settled
    FROM contributions c
    WHERE c.member_id = p_member_id
    GROUP BY c.membership_id
  ),
  nxt AS (
    SELECT DISTINCT ON (c.membership_id)
           c.membership_id, c.id, c.due_date, c.amount, c.amount_paid,
           COALESCE(c.penalty_due,0) AS penalty, c.status
    FROM contributions c
    WHERE c.member_id = p_member_id AND c.status <> 'paid'
    ORDER BY c.membership_id, c.due_date
  ),
  cred AS (
    SELECT l.membership_id, SUM(l.amount) AS balance
    FROM membership_credit_ledger l
    WHERE l.member_id = p_member_id
    GROUP BY l.membership_id
  )
  SELECT jsonb_build_object(
    'as_of', p_as_of,
    'member', (SELECT jsonb_build_object(
                 'id', m.id, 'member_code', m.member_id, 'full_name', m.full_name,
                 'phone', m.phone, 'status', m.status,
                 'mobile_money_number', m.mobile_money_number,
                 'mobile_money_provider', m.mobile_money_provider)
               FROM members m WHERE m.id = p_member_id),
    -- Totals across every membership, computed here so no caller sums rows.
    'totals', jsonb_build_object(
      'due_today',        COALESCE((SELECT SUM(a.remaining_today)   FROM agg a JOIN ms ON ms.id=a.membership_id),0),
      'paid_all_time',    COALESCE((SELECT SUM(a.total_paid)        FROM agg a JOIN ms ON ms.id=a.membership_id),0),
      'outstanding',      COALESCE((SELECT SUM(a.total_outstanding) FROM agg a JOIN ms ON ms.id=a.membership_id),0),
      'expected',         COALESCE((SELECT SUM(a.total_expected)    FROM agg a JOIN ms ON ms.id=a.membership_id),0),
      'overdue',          COALESCE((SELECT SUM(a.overdue)           FROM agg a JOIN ms ON ms.id=a.membership_id),0),
      'advance_credit',   COALESCE((SELECT SUM(c.balance)           FROM cred c JOIN ms ON ms.id=c.membership_id),0),
      'active_memberships', (SELECT COUNT(*) FROM ms)),
    'memberships', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'membership_id',   ms.id,
        'group_id',        ms.group_id,
        'group_name',      ms.group_name,
        'status',          ms.status,
        'slot_fraction',   ms.slot_fraction,
        'payout_position', ms.payout_position,
        'payout_date',     ms.payout_date,
        -- The membership's own figure wins; the group cashout is only a
        -- default. 62 of 65 differing values in production come from
        -- onboarding real historical amounts, and 24 have already been paid
        -- at that figure — so the stored value is authoritative.
        'payout_amount',   COALESCE(ms.payout_amount, ROUND(ms.cashout_amount * COALESCE(ms.slot_fraction,1), 2)),
        'payout_received', ms.payout_received,
        'contribution_amount', ROUND(ms.contribution_amount * COALESCE(ms.slot_fraction,1), 2),
        'frequency',       ms.contribution_frequency,
        'payment_deadline',ms.payment_deadline,
        'due_today',       COALESCE(a.remaining_today, 0),
        'paid_today',      COALESCE(a.paid_today, 0),
        'total_paid',      COALESCE(a.total_paid, 0),
        'total_expected',  COALESCE(a.total_expected, 0),
        'total_outstanding', COALESCE(a.total_outstanding, 0),
        'overdue',         COALESCE(a.overdue, 0),
        'paid_in_advance', COALESCE(a.paid_in_advance, 0),
        'days_covered_ahead', COALESCE(a.days_covered_ahead, 0),
        'obligations',     COALESCE(a.obligations, 0),
        'obligations_settled', COALESCE(a.obligations_settled, 0),
        'advance_credit',  COALESCE(cr.balance, 0),
        'next_obligation', CASE WHEN n.id IS NULL THEN NULL ELSE jsonb_build_object(
            'id', n.id, 'due_date', n.due_date, 'amount', n.amount,
            'amount_paid', n.amount_paid, 'penalty', n.penalty,
            'remaining', GREATEST(n.amount + n.penalty - n.amount_paid, 0),
            'status', n.status) END,
        -- The vocabulary the portal needs and nothing today can produce.
        'coverage', CASE
          WHEN a.obligations IS NULL                       THEN 'no-schedule'
          WHEN COALESCE(a.remaining_today,0) <= 0.005
               AND COALESCE(a.days_covered_ahead,0) > 0    THEN 'paid-in-advance'
          WHEN COALESCE(a.remaining_today,0) <= 0.005
               AND COALESCE(a.due_today_total,0) > 0       THEN 'paid-today'
          WHEN COALESCE(a.overdue,0) > 0.005               THEN 'overdue'
          WHEN COALESCE(a.paid_today,0) > 0.005            THEN 'partially-covered'
          WHEN COALESCE(a.due_today_total,0) > 0           THEN 'due-today'
          ELSE 'upcoming' END)
      ORDER BY ms.group_name)
      FROM ms
      LEFT JOIN agg  a  ON a.membership_id  = ms.id
      LEFT JOIN nxt  n  ON n.membership_id  = ms.id
      LEFT JOIN cred cr ON cr.membership_id = ms.id), '[]'::jsonb)
  );
$$;

COMMENT ON FUNCTION get_member_portal_state(UUID, DATE) IS
  'Everything the member portal renders, for every membership, in ONE query. '
  'Replaces member-profile''s 6 + 2N round trips and its last-50-rows totals.';


-- ── PART R (D-05) — admin totals, aggregated in the database ─────────────
DROP FUNCTION IF EXISTS get_admin_totals(DATE);

CREATE FUNCTION get_admin_totals(p_as_of DATE DEFAULT CURRENT_DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'as_of', p_as_of,
    'collected', (
      -- Was: SELECT every successful transaction, then reduce() in JS.
      SELECT jsonb_build_object(
        'all_time',   COALESCE(SUM(t.amount),0),
        'today',      COALESCE(SUM(t.amount) FILTER (WHERE t.created_at::date = p_as_of),0),
        'this_month', COALESCE(SUM(t.amount) FILTER (WHERE date_trunc('month',t.created_at) = date_trunc('month',p_as_of::timestamptz)),0),
        'payments',   COUNT(*))
      FROM transactions t
      WHERE t.status='success' AND t.type IN ('contribution','registration_fee')),
    'contributions', (
      SELECT jsonb_build_object(
        'expected',    COALESCE(SUM(amount),0),
        'paid',        COALESCE(SUM(amount) FILTER (WHERE status='paid'),0),
        'outstanding', COALESCE(SUM(amount) FILTER (WHERE status<>'paid'),0),
        'overdue',     COALESCE(SUM(amount) FILTER (WHERE status='overdue'),0),
        'due_today',   COALESCE(SUM(amount) FILTER (WHERE due_date=p_as_of),0),
        'paid_today',  COALESCE(SUM(amount_paid) FILTER (WHERE due_date=p_as_of),0))
      FROM contributions),
    'members', (
      SELECT jsonb_build_object(
        'total',  COUNT(*),
        'active', COUNT(*) FILTER (WHERE status='active'))
      FROM members),
    'memberships', (
      SELECT jsonb_build_object(
        'active',    COUNT(*) FILTER (WHERE status='active'),
        'defaulted', COUNT(*) FILTER (WHERE status='defaulted'))
      FROM group_memberships),
    'payouts', (
      SELECT jsonb_build_object(
        'paid',        COALESCE(SUM(total_amount) FILTER (WHERE status='paid'),0),
        'upcoming',    COALESCE(SUM(total_amount) FILTER (WHERE status='upcoming'),0),
        'due_7_days',  COALESCE(SUM(total_amount) FILTER (WHERE status='upcoming' AND scheduled_date BETWEEN p_as_of AND p_as_of+7),0))
      FROM payouts),
    'anomalies', jsonb_build_object(
      'pending_over_48h',        (SELECT COUNT(*) FROM transactions WHERE status='pending' AND created_at < now()-interval '48 hours'),
      'pending_over_48h_value',  (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE status='pending' AND created_at < now()-interval '48 hours'),
      'allocations_vs_unpaid',   (SELECT COUNT(*) FROM payment_allocations pa JOIN contributions c ON c.id=pa.contribution_id WHERE c.status<>'paid'),
      'memberships_no_schedule', (SELECT COUNT(*) FROM group_memberships gm WHERE gm.status='active'
                                    AND NOT EXISTS (SELECT 1 FROM contributions c WHERE c.membership_id=gm.id)),
      'active_group_memberships_no_payout_date',
                                 (SELECT COUNT(*) FROM group_memberships gm JOIN susu_groups g ON g.id=gm.group_id
                                   WHERE gm.status='active' AND g.status='active' AND gm.payout_date IS NULL),
      'approved_registrations_unpaid',
                                 (SELECT COUNT(*) FROM kyc_applications WHERE status='approved' AND NOT COALESCE(registration_fee_paid,false)))
  );
$$;

COMMENT ON FUNCTION get_admin_totals(DATE) IS
  'Admin dashboard figures, aggregated in the database. Replaces the unbounded '
  'fetch-and-reduce in admin-dashboard. Correct at any table size.';

-- Consistent with v25: Edge Functions only.
REVOKE ALL ON FUNCTION get_member_portal_state(UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_admin_totals(DATE) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION get_member_portal_state(UUID,DATE) FROM anon';
    EXECUTE 'REVOKE ALL ON FUNCTION get_admin_totals(DATE) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION get_member_portal_state(UUID,DATE) FROM authenticated';
    EXECUTE 'REVOKE ALL ON FUNCTION get_admin_totals(DATE) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION get_member_portal_state(UUID,DATE) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION get_admin_totals(DATE) TO service_role';
  END IF;
END $$;

COMMIT;
