-- ============================================================================
-- V35 — THE RECONCILIATION QUEUE  (Phase 06)
-- ============================================================================
-- Read-only. Lists the financial state that cannot be resolved from data alone,
-- with everything a person needs in order to decide.
--
-- Two populations:
--   13 approved registrations whose fee was never received (GHS 1,320.50)
--   402 payments pending for more than 48 hours          (GHS 40,658)
--
-- Neither is auto-resolved. The whole point of this function is that unresolved
-- financial state should be VISIBLE rather than quietly carried.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS get_reconciliation_queue();

CREATE FUNCTION get_reconciliation_queue()
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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
        WHERE c.status <> 'paid'))
  );
$$;

COMMENT ON FUNCTION get_reconciliation_queue() IS
  'Unresolved financial state, surfaced for a human decision. Read-only.';

REVOKE ALL ON FUNCTION get_reconciliation_queue() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION get_reconciliation_queue() FROM anon'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION get_reconciliation_queue() FROM authenticated'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION get_reconciliation_queue() TO service_role'; END IF;
END $$;

COMMIT;
