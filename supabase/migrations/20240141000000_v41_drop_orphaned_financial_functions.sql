-- ============================================================================
-- v41 — REMOVE THE LAST ORPHANED FINANCIAL FUNCTIONS; COMPLETE THE PORTAL TOTALS
-- ============================================================================
-- Drops five functions. Changes no table, no row and no financial value.
-- Replaces one function body, adding two derived totals.
--
-- ── WHY THESE FIVE GO ───────────────────────────────────────────────────────
--
-- record_partial_payment() was a settlement engine. It wrote `amount_paid`,
-- `status = 'paid'` and `paid_at` straight onto a contribution with:
--
--     no row lock      (SELECT * INTO, never FOR UPDATE — two concurrent calls
--                       read the same amount_paid and both add to it)
--     no allocation    (nothing recorded what the money covered)
--     no idempotency   (a replay adds the amount again)
--     no settlement log, no audit row
--
-- It has no caller. Not in the edge functions, not in a trigger, not in another
-- database function, not in a view, not in a column default. `payments-manual`
-- names it once, in a comment explaining that the engine replaced it. Directed
-- settlement of one obligation is `settle_payment(p_target_contributions => …)`,
-- which does the same job atomically, under a lock, with a ledger and an audit
-- trail.
--
-- A deployed SECURITY DEFINER function that mutates money and answers to nobody
-- is a liability whether or not anything calls it today. Dead financial code is
-- one `rpc()` away from being live financial code.
--
-- get_member_plan_balance() and get_membership_balance() are a second
-- definition of "total paid": they sum `amount` where `status = 'paid'` and
-- ignore `amount_paid` entirely, so they report zero for every part-paid day
-- and disagree with get_member_statement() and get_member_portal_state() by
-- exactly the part-payments. Two functions that disagree about what a member
-- has paid is the D-05 shape. Neither has a caller.
--
-- revoke_admin_sessions() and revoke_member_sessions() predate `token_version`,
-- which is what actually invalidates sessions now (and what
-- change_admin_password() bumps). Neither has a caller.
--
-- ── WHAT IS NOT DROPPED ─────────────────────────────────────────────────────
-- No table. No column. No index. No row. Financial history is untouched: this
-- migration cannot change a single number, and the checksum either side proves
-- it.
-- ============================================================================

DROP FUNCTION IF EXISTS record_partial_payment(uuid, numeric, text, text);
DROP FUNCTION IF EXISTS get_member_plan_balance(uuid, uuid);
DROP FUNCTION IF EXISTS get_membership_balance(uuid);
DROP FUNCTION IF EXISTS revoke_admin_sessions(uuid);
DROP FUNCTION IF EXISTS revoke_member_sessions(uuid);

-- ============================================================================
-- get_member_portal_state — three today-figures instead of one
-- ============================================================================
-- The portal showed "due today", which is what REMAINS after part-payments. A
-- member holding five groups could not see what they owed in total today, nor
-- what they had already paid today, because neither figure existed. Both are
-- derived here rather than summed in the browser, so the console and the
-- database cannot disagree about them.
--
-- This is a CREATE OR REPLACE of the deployed body with two lines added to the
-- `totals` object. Nothing else in the function changes.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_member_portal_state(p_member_id uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
      -- Three separate figures, because a member cannot reconstruct the other
      -- two from one. `due_today` is what REMAINS; the gross obligation and the
      -- amount already paid are their own numbers.
      'obligation_today', COALESCE((SELECT SUM(a.due_today_total)   FROM agg a JOIN ms ON ms.id=a.membership_id),0),
      'paid_today',       COALESCE((SELECT SUM(a.paid_today)        FROM agg a JOIN ms ON ms.id=a.membership_id),0),
      'remaining_today',  COALESCE((SELECT SUM(a.remaining_today)   FROM agg a JOIN ms ON ms.id=a.membership_id),0),
      -- `due_today` has always meant what REMAINS. The name is ambiguous now
      -- that the gross obligation is also published, so `remaining_today` above
      -- says it plainly; this stays so existing callers keep working.
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
$function$
;
