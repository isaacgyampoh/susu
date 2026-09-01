-- ============================================================================
-- v40 — RECONCILIATION QUEUE: a third population, and the fields the console needs
-- ============================================================================
-- Read-only. Replaces one function body; changes no data.
--
-- WHAT CHANGED AND WHY
--
-- 1. A THIRD POPULATION. Phase 07's new invariant 12 found seven applications
--    marked `registration_fee_paid = true` with no successful registration
--    payment anywhere and no audit row — GHS 1,745, all from 19–21 July 2026.
--    They are the mirror image of the 13 known unpaid registrations: those say
--    "unpaid" and may have been paid, these say "paid" with nothing behind it.
--
--    They are NOT corrected here. Reversing a fee flag on a live member on the
--    strength of a missing record would be guessing at payment status, and six
--    of the seven point at groups that have since been deleted, so the
--    surrounding evidence is gone too. They are surfaced, counted, and left
--    for the operator — who may simply remember taking the cash.
--
-- 2. AGE, on every stuck payment. "Pending" means something different at two
--    days and at two months, and the console has to show that difference.
--
-- 3. RESOLUTION STATE, on every unpaid registration, so a decision already
--    recorded (v37) is visible rather than being asked for again.
--
-- 4. SERVER-SIDE PAGINATION for the stuck-payment list. Totals stay database
--    -derived and complete; only the page of rows is bounded.
-- ============================================================================
CREATE OR REPLACE FUNCTION get_reconciliation_queue(
  p_limit  integer DEFAULT 200,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT jsonb_build_object(
    'generated_at', now(),
    'page', jsonb_build_object('limit', GREATEST(1, LEAST(p_limit, 500)), 'offset', GREATEST(0, p_offset)),

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
          'active_memberships', (SELECT count(*) FROM group_memberships gm
                                 WHERE gm.member_id = m.id AND gm.status='active'),
          'contributed_since', (SELECT COALESCE(sum(c.amount_paid),0) FROM contributions c
                                WHERE c.member_id = m.id),
          -- A decision already recorded, so the operator is not asked twice.
          'resolution', k.fee_resolution,
          'resolution_reason', k.fee_resolution_reason,
          'resolution_at', k.fee_resolution_at)
        ORDER BY k.registration_fee_amount DESC NULLS LAST)
        FROM kyc_applications k LEFT JOIN members m ON m.id = k.created_member_id
        WHERE k.status='approved' AND NOT COALESCE(k.registration_fee_paid,false)), '[]'::jsonb)),

    -- ── The new population ────────────────────────────────────────────────
    'paid_without_evidence', jsonb_build_object(
      'count', (SELECT count(*) FROM kyc_applications k
                 WHERE COALESCE(k.registration_fee_paid,false)
                   AND COALESCE(k.registration_fee_amount,0) > 0
                   AND NOT EXISTS (SELECT 1 FROM transactions t
                                    WHERE t.type='registration_fee' AND t.status='success'
                                      AND (t.kyc_application_id=k.id OR t.member_id=k.created_member_id))
                   AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id=k.id
                                    AND a.action IN ('registration.fee_received','registration.approved_without_payment',
                                                     'registration.fee_settled','registration.marked_fee_paid'))),
      'value', (SELECT COALESCE(sum(k.registration_fee_amount),0) FROM kyc_applications k
                 WHERE COALESCE(k.registration_fee_paid,false)
                   AND COALESCE(k.registration_fee_amount,0) > 0
                   AND NOT EXISTS (SELECT 1 FROM transactions t
                                    WHERE t.type='registration_fee' AND t.status='success'
                                      AND (t.kyc_application_id=k.id OR t.member_id=k.created_member_id))
                   AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id=k.id
                                    AND a.action IN ('registration.fee_received','registration.approved_without_payment',
                                                     'registration.fee_settled','registration.marked_fee_paid'))),
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', k.id, 'name', k.full_name, 'phone', k.phone,
          'fee', k.registration_fee_amount, 'status', k.status::text,
          'submitted', k.submitted_at::date,
          'member_code', m.member_id, 'member_status', m.status,
          -- Six of the seven point at groups that have since been deleted.
          -- Saying so is the difference between a puzzle and a decision.
          'groups_still_exist', EXISTS (
            SELECT 1 FROM susu_groups g
             WHERE g.id = ANY(COALESCE(k.selected_group_ids, ARRAY[k.selected_group_id]))),
          'pending_or_failed_attempts', (
            SELECT count(*) FROM transactions t
             WHERE t.type='registration_fee'
               AND (t.kyc_application_id=k.id OR t.member_id=k.created_member_id)),
          'resolution', k.fee_resolution)
        ORDER BY k.registration_fee_amount DESC NULLS LAST)
        FROM kyc_applications k LEFT JOIN members m ON m.id = k.created_member_id
        WHERE COALESCE(k.registration_fee_paid,false)
          AND COALESCE(k.registration_fee_amount,0) > 0
          AND NOT EXISTS (SELECT 1 FROM transactions t
                           WHERE t.type='registration_fee' AND t.status='success'
                             AND (t.kyc_application_id=k.id OR t.member_id=k.created_member_id))
          AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.entity_id=k.id
                           AND a.action IN ('registration.fee_received','registration.approved_without_payment',
                                            'registration.fee_settled','registration.marked_fee_paid'))), '[]'::jsonb)),

    'stuck_payments', jsonb_build_object(
      'count', (SELECT count(*) FROM transactions
                WHERE status='pending' AND created_at < now() - interval '48 hours'),
      'value', (SELECT COALESCE(sum(amount),0) FROM transactions
                WHERE status='pending' AND created_at < now() - interval '48 hours'),
      'by_kind', COALESCE((
        SELECT jsonb_agg(x ORDER BY x->>'value' DESC) FROM (
          SELECT jsonb_build_object(
            'prefix', substring(t.reference from '^[A-Za-z]+'),
            'count', count(*), 'value', sum(t.amount),
            'oldest', min(t.created_at)::date, 'newest', max(t.created_at)::date,
            'has_provider_reference',
              count(*) FILTER (WHERE t.paystack_data->>'provider_order_id' IS NOT NULL)) AS x
          FROM transactions t
          WHERE t.status='pending' AND t.created_at < now() - interval '48 hours'
          GROUP BY substring(t.reference from '^[A-Za-z]+')) y), '[]'::jsonb),
      -- One page. `count` and `value` above are complete and unpaginated, so a
      -- shorter page can never understate the money.
      'items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', t.id, 'reference', t.reference, 'amount', t.amount,
          'created', t.created_at, 'type', t.type,
          'age_days', EXTRACT(day FROM now() - t.created_at)::int,
          'member_code', m.member_id, 'member_name', m.full_name,
          'membership_id', c.membership_id,
          'provider_reference', t.paystack_data->>'provider_order_id',
          -- Without a provider reference NaloPay cannot be asked about this
          -- payment at all, so the console must not offer to refresh it.
          'refreshable', (t.paystack_data->>'provider_order_id') IS NOT NULL,
          'group', g.name)
        ORDER BY t.amount DESC)
        FROM (
          SELECT * FROM transactions
           WHERE status='pending' AND created_at < now() - interval '48 hours'
           ORDER BY amount DESC
           LIMIT GREATEST(1, LEAST(p_limit, 500)) OFFSET GREATEST(0, p_offset)) t
        LEFT JOIN members m ON m.id = t.member_id
        LEFT JOIN contributions c ON c.id = t.related_id
        LEFT JOIN susu_groups g ON g.id = c.group_id), '[]'::jsonb)),

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
$function$;

REVOKE ALL ON FUNCTION get_reconciliation_queue(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_reconciliation_queue(integer, integer) TO service_role;

-- The zero-argument version is now an ambiguous overload of the same name.
-- Two functions that can both answer `get_reconciliation_queue()` is exactly
-- the overload hazard v38 removed from get_member_statement.
DROP FUNCTION IF EXISTS get_reconciliation_queue();
