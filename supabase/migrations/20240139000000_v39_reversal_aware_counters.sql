-- ============================================================================
-- v39 — HEALTH COUNTERS MUST IGNORE REVERSED ALLOCATIONS
-- ============================================================================
-- v38 made a reversed allocation a stamped row rather than a deleted one, so
-- the history survives. Two health counters count allocations that point at an
-- unpaid day — the F-02 alarm — and would now count every deliberate reversal
-- as a defect. An alarm that fires on correct operator behaviour is an alarm
-- people learn to ignore.
--
-- These are CREATE OR REPLACE of the deployed bodies with one predicate added
-- to each. Nothing else in either function changes.
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

CREATE OR REPLACE FUNCTION public.get_reconciliation_queue()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'generated_at', now(),

    'unpaid_registrations', jsonb_build_object(
      'count', (SELECT count(*) FROM kyc_applications
                WHERE status='approved' AND NOT COALESCE(registration_fee_paid,false)),
      'value', (SELECT COALESCE(sum(registration_fee_amount),0) FROM kyc_applications
                WHERE status='approved' AND NOT COALESCE(registration_fee_paid,false)),
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', k.id, 'name', k.full_name, 'phone', k.phone,
          'fee', k.registration_fee_amount,
          'submitted', k.submitted_at::date, 'reviewed', k.reviewed_at::date,
          'member_code', m.member_id, 'member_status', m.status,
          -- Whether the member this created is live, and how much they hold.
          'active_memberships', (SELECT count(*) FROM group_memberships gm
                                 WHERE gm.member_id = m.id AND gm.status='active'),
          'contributed_since', (SELECT COALESCE(sum(c.amount_paid),0) FROM contributions c
                                WHERE c.member_id = m.id))
        ORDER BY k.registration_fee_amount DESC NULLS LAST)
        FROM kyc_applications k LEFT JOIN members m ON m.id = k.created_member_id
        WHERE k.status='approved' AND NOT COALESCE(k.registration_fee_paid,false)), '[]'::jsonb)),

    'stuck_payments', jsonb_build_object(
      'count', (SELECT count(*) FROM transactions
                WHERE status='pending' AND created_at < now() - interval '48 hours'),
      'value', (SELECT COALESCE(sum(amount),0) FROM transactions
                WHERE status='pending' AND created_at < now() - interval '48 hours'),
      -- Grouped, because 402 individual rows is not a decision surface.
      'by_kind', COALESCE((
        SELECT jsonb_agg(x ORDER BY x->>'value' DESC) FROM (
          SELECT jsonb_build_object(
            'prefix', substring(t.reference from '^[A-Za-z]+'),
            'count', count(*), 'value', sum(t.amount),
            'oldest', min(t.created_at)::date, 'newest', max(t.created_at)::date,
            -- Without a provider reference the prompt never reached NaloPay,
            -- which is itself strong evidence about what happened.
            'has_provider_reference',
              count(*) FILTER (WHERE t.paystack_data->>'provider_order_id' IS NOT NULL)) AS x
          FROM transactions t
          WHERE t.status='pending' AND t.created_at < now() - interval '48 hours'
          GROUP BY substring(t.reference from '^[A-Za-z]+')) y), '[]'::jsonb),
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', t.id, 'reference', t.reference, 'amount', t.amount,
          'created', t.created_at, 'type', t.type,
          'member_code', m.member_id, 'member_name', m.full_name,
          'provider_reference', t.paystack_data->>'provider_order_id',
          'group', g.name)
        ORDER BY t.amount DESC)
        FROM transactions t
        LEFT JOIN members m ON m.id = t.member_id
        LEFT JOIN contributions c ON c.id = t.related_id
        LEFT JOIN susu_groups g ON g.id = c.group_id
        WHERE t.status='pending' AND t.created_at < now() - interval '48 hours'
        LIMIT 500), '[]'::jsonb)),

    -- Everything else worth an operator's attention, counted in the database.
    'other', jsonb_build_object(
      'memberships_without_schedule', (
        SELECT count(*) FROM group_memberships gm JOIN susu_groups g ON g.id=gm.group_id
        WHERE gm.status='active' AND g.status='active'
          AND NOT EXISTS (SELECT 1 FROM contributions c WHERE c.membership_id=gm.id)),
      'active_group_memberships_without_payout_date', (
        SELECT count(*) FROM group_memberships gm JOIN susu_groups g ON g.id=gm.group_id
        WHERE gm.status='active' AND g.status='active' AND gm.payout_date IS NULL),
      'allocations_against_unpaid_days', (
        SELECT count(*) FROM payment_allocations pa JOIN contributions c ON c.id=pa.contribution_id
        WHERE c.status <> 'paid' AND pa.reversed_at IS NULL))
  );
$function$
;
