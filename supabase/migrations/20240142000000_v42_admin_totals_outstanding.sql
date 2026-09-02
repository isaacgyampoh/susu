-- ============================================================================
-- v42 — ADMIN TOTALS: OUTSTANDING MUST SUBTRACT WHAT HAS BEEN PAID
-- ============================================================================
-- Read-only change. Replaces one function body. No table, row or value moves.
--
-- Found by recomputing every headline dashboard figure from first principles
-- and comparing (docs/phase-08/admin-totals-crosscheck.sql). Two of fifteen
-- differed for a reason that was not timing:
--
--   outstanding    SUM(amount) over unpaid days — `amount_paid` ignored, so a
--                  day with GHS 75 of a GHS 100 obligation already collected
--                  reported the full GHS 100 as still owed. GHS 25 today; it
--                  grows with every instalment, and instalments are a feature.
--                  This is the D-05 defect class: an operator-facing total that
--                  disagrees with the ledger underneath it.
--
--   due_today      the GROSS obligation for today, including days already
--                  settled. A defensible figure, but on a dashboard it reads
--                  as "what we expect to collect today", which it stops being
--                  the moment part of it is collected. Kept, with the
--                  remaining figure published beside it.
--
-- A third difference — `collected all_time` — was the CROSS-CHECK being wrong,
-- not the function: `get_admin_totals` deliberately excludes `type='payout'`,
-- because money paid OUT is not money collected. That exclusion is correct and
-- stays.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_admin_totals(p_as_of date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
        -- Outstanding is what is STILL OWED, so a part-payment reduces it.
        -- This used to be SUM(amount) on every unpaid day, ignoring
        -- amount_paid entirely — so a day with GHS 75 of a GHS 100 obligation
        -- already collected still reported the whole GHS 100 as outstanding.
        -- Small today, but it grows with every instalment taken, and partial
        -- payment is a core feature. Same defect class as D-05.
        'outstanding', COALESCE(SUM(amount - COALESCE(amount_paid,0)) FILTER (WHERE status<>'paid'),0),
        'overdue',     COALESCE(SUM(amount) FILTER (WHERE status='overdue'),0),
        -- `due_today` is the GROSS obligation falling due today, including
        -- days already settled. On a dashboard that reads as "money we expect
        -- to collect today", which it is not once part of it is collected — so
        -- the figure an operator actually wants is published beside it.
        'due_today',   COALESCE(SUM(amount) FILTER (WHERE due_date=p_as_of),0),
        'remaining_today', COALESCE(SUM(amount - COALESCE(amount_paid,0))
                                    FILTER (WHERE due_date=p_as_of AND status<>'paid'),0),
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
      'allocations_vs_unpaid',   (SELECT COUNT(*) FROM payment_allocations pa JOIN contributions c ON c.id=pa.contribution_id WHERE c.status<>'paid' AND pa.reversed_at IS NULL),
      'memberships_no_schedule', (SELECT COUNT(*) FROM group_memberships gm WHERE gm.status='active'
                                    AND NOT EXISTS (SELECT 1 FROM contributions c WHERE c.membership_id=gm.id)),
      'active_group_memberships_no_payout_date',
                                 (SELECT COUNT(*) FROM group_memberships gm JOIN susu_groups g ON g.id=gm.group_id
                                   WHERE gm.status='active' AND g.status='active' AND gm.payout_date IS NULL),
      'approved_registrations_unpaid',
                                 (SELECT COUNT(*) FROM kyc_applications WHERE status='approved' AND NOT COALESCE(registration_fee_paid,false)))
  );
$function$
;
