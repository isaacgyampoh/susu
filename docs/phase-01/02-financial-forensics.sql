-- ============================================================================
-- PHASE 01 · QUERY 2 of 3 — FINANCIAL FORENSICS
-- ============================================================================
-- Read-only. No writes, no locks beyond ordinary shared read locks.
--
-- This answers the questions that decide the order of the rebuild. Above all
-- it settles F-02: whether the UNIQUE index on contributions.paystack_ref is
-- live and, if so, whether it has already been silently swallowing days that
-- a member actually paid for.
--
-- Returns one row, one JSON column. Copy the cell and send it back.
--
-- The single most important key in the output is:
--     f02_smoking_gun.allocations_claiming_unpaid_days
-- If that count is greater than zero, money has been recorded as allocated to
-- days that are still marked unpaid, and members are being asked to pay twice.
--
-- ── IF THIS ERRORS ──────────────────────────────────────────────────────────
-- Send me the error text verbatim. It is diagnostic, not a nuisance.
--
-- PostgreSQL parses an entire statement before running any of it, so there is
-- no way to write this query to "skip" a table or column that is absent — a
-- guarded branch is still parsed. That is deliberate here: an error reading
--
--     relation "payment_allocations" does not exist
--     column "slot_fraction" does not exist
--     column "credit_balance" does not exist
--
-- tells us that migration v24 / v15 / v24 respectively was never applied to
-- production, which is precisely the drift this phase exists to find. Name the
-- missing object and I will tell you what it means and reissue the query
-- without it.
-- ============================================================================

SELECT jsonb_pretty(jsonb_build_object(

  'captured_at', now(),

  -- ── Scale: how big is this, really ──────────────────────────────────────
  'row_counts', jsonb_build_object(
    'members',              (SELECT count(*) FROM members),
    'members_active',       (SELECT count(*) FROM members WHERE status = 'active'),
    'susu_groups',          (SELECT count(*) FROM susu_groups),
    'groups_active',        (SELECT count(*) FROM susu_groups WHERE status = 'active'),
    'group_memberships',    (SELECT count(*) FROM group_memberships),
    'memberships_active',   (SELECT count(*) FROM group_memberships WHERE status = 'active'),
    'contributions',        (SELECT count(*) FROM contributions),
    'contributions_paid',   (SELECT count(*) FROM contributions WHERE status = 'paid'),
    'contributions_pending',(SELECT count(*) FROM contributions WHERE status = 'pending'),
    'contributions_overdue',(SELECT count(*) FROM contributions WHERE status = 'overdue'),
    'transactions',         (SELECT count(*) FROM transactions),
    'payouts',              (SELECT count(*) FROM payouts),
    'payment_penalties',    (SELECT count(*) FROM payment_penalties),
    'payment_allocations',  (SELECT count(*) FROM payment_allocations)
  ),

  -- ── F-02: the paystack_ref unique index ─────────────────────────────────
  'f02_paystack_ref_index', jsonb_build_object(
    'index_exists', EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname='public' AND tablename='contributions' AND indexname='uniq_contribution_ref'),
    'index_definition', (
      SELECT indexdef FROM pg_indexes
      WHERE schemaname='public' AND tablename='contributions' AND indexname='uniq_contribution_ref'),
    'any_unique_index_on_paystack_ref', (
      SELECT COALESCE(jsonb_agg(indexdef), '[]'::jsonb) FROM pg_indexes
      WHERE schemaname='public' AND tablename='contributions'
        AND indexdef LIKE 'CREATE UNIQUE%' AND indexdef LIKE '%paystack_ref%'),

    -- If duplicates exist, the unique index CANNOT be live — and one payment
    -- demonstrably does cover several days in production.
    'distinct_refs',            (SELECT count(DISTINCT paystack_ref) FROM contributions WHERE paystack_ref IS NOT NULL),
    'rows_with_ref',            (SELECT count(*) FROM contributions WHERE paystack_ref IS NOT NULL),
    'refs_covering_many_days',  (SELECT count(*) FROM (
                                   SELECT paystack_ref FROM contributions
                                   WHERE paystack_ref IS NOT NULL
                                   GROUP BY paystack_ref HAVING count(*) > 1) d),
    'max_days_on_one_ref',      (SELECT COALESCE(max(n),0) FROM (
                                   SELECT count(*) n FROM contributions
                                   WHERE paystack_ref IS NOT NULL GROUP BY paystack_ref) d),
    'top_multi_day_refs',       (SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
                                   SELECT paystack_ref AS ref, count(*) AS days,
                                          sum(amount) AS total, min(due_date) AS from_day,
                                          max(due_date) AS to_day
                                   FROM contributions WHERE paystack_ref IS NOT NULL
                                   GROUP BY paystack_ref HAVING count(*) > 1
                                   ORDER BY count(*) DESC LIMIT 10) x)
  ),

  -- ── F-02 SMOKING GUN ────────────────────────────────────────────────────
  -- An allocation row says "this payment covered this day". If the matching
  -- contribution is not paid, then settle.ts decremented its running total and
  -- wrote the allocation, but the UPDATE that marks the day paid did not take
  -- effect — exactly the silent unique-violation failure described in F-02.
  -- Every row here is a day a member paid for and is still being billed for.
  'f02_smoking_gun', (
    SELECT jsonb_build_object(
        'allocations_claiming_unpaid_days', (
          SELECT count(*) FROM payment_allocations pa
          JOIN contributions c ON c.id = pa.contribution_id
          WHERE c.status <> 'paid'),
        'value_at_risk', (
          SELECT COALESCE(sum(pa.amount), 0) FROM payment_allocations pa
          JOIN contributions c ON c.id = pa.contribution_id
          WHERE c.status <> 'paid'),
        'affected_members', (
          SELECT count(DISTINCT pa.member_id) FROM payment_allocations pa
          JOIN contributions c ON c.id = pa.contribution_id
          WHERE c.status <> 'paid'),
        'examples', (
          SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
            SELECT pa.reference, pa.amount AS allocated, pa.group_name,
                   c.due_date, c.status AS contribution_status,
                   c.amount AS day_amount, c.amount_paid
            FROM payment_allocations pa
            JOIN contributions c ON c.id = pa.contribution_id
            WHERE c.status <> 'paid'
            ORDER BY pa.created_at DESC LIMIT 25) x),
        'orphan_allocations', (
          SELECT count(*) FROM payment_allocations pa
          LEFT JOIN contributions c ON c.id = pa.contribution_id
          WHERE c.id IS NULL)
      )
  ),

  -- ── Ledger consistency across the five settlement paths ─────────────────
  -- Each blanket-update path leaves a different fingerprint.
  'settlement_path_fingerprints', jsonb_build_object(
    -- settle.ts sets amount_paid; the blanket-update paths do not.
    'paid_but_amount_paid_zero', (
      SELECT count(*) FROM contributions WHERE status='paid' AND COALESCE(amount_paid,0)=0),
    'paid_but_amount_paid_short', (
      SELECT count(*) FROM contributions
      WHERE status='paid' AND COALESCE(amount_paid,0) > 0 AND amount_paid < amount - 0.005),
    'paid_with_no_ref_and_no_method', (
      SELECT count(*) FROM contributions
      WHERE status='paid' AND paystack_ref IS NULL AND payment_method IS NULL),
    'paid_via_batch', (
      SELECT count(*) FROM contributions WHERE status='paid' AND batch_id IS NOT NULL),
    'paid_manual', (
      SELECT count(*) FROM contributions WHERE status='paid' AND payment_method IN ('cash','momo','bank')),
    -- Partial payments currently in flight
    'partially_paid_open', (
      SELECT count(*) FROM contributions
      WHERE status <> 'paid' AND COALESCE(amount_paid,0) > 0),
    'partially_paid_value', (
      SELECT COALESCE(sum(amount_paid),0) FROM contributions
      WHERE status <> 'paid' AND COALESCE(amount_paid,0) > 0),
    -- Overpaid rows should be impossible
    'amount_paid_exceeds_amount', (
      SELECT count(*) FROM contributions WHERE COALESCE(amount_paid,0) > amount + 0.005)
  ),

  -- ── credit_balance (F-06 race) ──────────────────────────────────────────
  'credit_balance', jsonb_build_object(
    'members_with_credit', (
      SELECT count(*) FROM members WHERE COALESCE(credit_balance,0) > 0),
    'total_credit_held',   (SELECT COALESCE(sum(credit_balance),0) FROM members),
    'max_credit',          (SELECT COALESCE(max(credit_balance),0) FROM members),
    'negative_credit',     (SELECT count(*) FROM members WHERE COALESCE(credit_balance,0) < 0)
  ),

  -- ── F-14: plaintext passcodes actually written? ─────────────────────────
  -- A bcrypt hash is 60 chars and starts '$2'. Anything else in this column
  -- is either a plaintext PIN or an unusable value that locks the member out.
  'f14_passcode_integrity', jsonb_build_object(
    'total_with_passcode',   (SELECT count(*) FROM members WHERE passcode_hash IS NOT NULL),
    'valid_bcrypt',          (SELECT count(*) FROM members WHERE passcode_hash ~ '^\$2[aby]?\$\d{2}\$'),
    'PLAINTEXT_OR_INVALID',  (SELECT count(*) FROM members
                              WHERE passcode_hash IS NOT NULL AND passcode_hash !~ '^\$2[aby]?\$\d{2}\$'),
    'looks_like_bare_pin',   (SELECT count(*) FROM members WHERE passcode_hash ~ '^\d{4,10}$'),
    'null_passcode_active',  (SELECT count(*) FROM members WHERE status='active' AND passcode_hash IS NULL),
    'affected_member_codes', (SELECT COALESCE(jsonb_agg(member_id), '[]'::jsonb) FROM (
                                SELECT member_id FROM members
                                WHERE passcode_hash IS NOT NULL
                                  AND passcode_hash !~ '^\$2[aby]?\$\d{2}\$' LIMIT 50) x)
  ),

  -- ── Target model validation: does multi-group / multi-slot exist today? ─
  'membership_shape', jsonb_build_object(
    'members_by_group_count', (
      SELECT COALESCE(jsonb_object_agg(groups::text, members), '{}'::jsonb) FROM (
        SELECT groups, count(*) AS members FROM (
          SELECT member_id, count(DISTINCT group_id) AS groups
          FROM group_memberships WHERE status='active' GROUP BY member_id) a
        GROUP BY groups ORDER BY groups) b),
    'max_groups_one_member',  (SELECT COALESCE(max(g),0) FROM (
                                 SELECT count(DISTINCT group_id) g FROM group_memberships
                                 WHERE status='active' GROUP BY member_id) x),
    'multi_slot_cases', (
      SELECT COALESCE(jsonb_agg(x), '[]'::jsonb) FROM (
        SELECT member_id, group_id, count(*) AS slots
        FROM group_memberships WHERE status='active'
        GROUP BY member_id, group_id HAVING count(*) > 1
        ORDER BY count(*) DESC LIMIT 20) x),
    'slot_fraction_used', (
      SELECT COALESCE(jsonb_object_agg(slot_fraction::text, n), '{}'::jsonb)
      FROM (SELECT slot_fraction, count(*) n FROM group_memberships GROUP BY slot_fraction) f),
    'shared_slots', (
      SELECT count(*) FROM group_memberships WHERE shared_slot_key IS NOT NULL),
    'memberships_by_status', (
      SELECT COALESCE(jsonb_object_agg(status::text, n), '{}'::jsonb)
      FROM (SELECT status, count(*) n FROM group_memberships GROUP BY status) s)
  ),

  -- ── Contributions without a schedule / orphaned memberships ─────────────
  'schedule_integrity', jsonb_build_object(
    'active_memberships_with_no_contributions', (
      SELECT count(*) FROM group_memberships gm
      WHERE gm.status='active'
        AND NOT EXISTS (SELECT 1 FROM contributions c WHERE c.membership_id = gm.id)),
    'contributions_with_null_membership', (
      SELECT count(*) FROM contributions WHERE membership_id IS NULL),
    'contributions_orphaned_membership', (
      SELECT count(*) FROM contributions c
      LEFT JOIN group_memberships gm ON gm.id = c.membership_id
      WHERE c.membership_id IS NOT NULL AND gm.id IS NULL),
    'duplicate_day_per_membership', (
      SELECT count(*) FROM (
        SELECT membership_id, due_date FROM contributions
        GROUP BY membership_id, due_date HAVING count(*) > 1) d)
  ),

  -- ── Payment / transaction health ────────────────────────────────────────
  'transaction_health', jsonb_build_object(
    'by_status', (SELECT COALESCE(jsonb_object_agg(status::text, n), '{}'::jsonb)
                  FROM (SELECT status, count(*) n FROM transactions GROUP BY status) s),
    'by_type',   (SELECT COALESCE(jsonb_object_agg(type::text, n), '{}'::jsonb)
                  FROM (SELECT type, count(*) n FROM transactions GROUP BY type) t),
    'pending_older_than_48h', (
      SELECT count(*) FROM transactions
      WHERE status='pending' AND created_at < now() - interval '48 hours'),
    'pending_value_stuck', (
      SELECT COALESCE(sum(amount),0) FROM transactions
      WHERE status='pending' AND created_at < now() - interval '48 hours'),
    -- Two transactions sharing one provider order id would break the
    -- webhook's .contains() lookup, which takes [0] arbitrarily.
    'duplicate_provider_order_ids', (
      SELECT count(*) FROM (
        SELECT paystack_data->>'provider_order_id' AS oid
        FROM transactions
        WHERE paystack_data->>'provider_order_id' IS NOT NULL
        GROUP BY 1 HAVING count(*) > 1) d),
    'success_tx_with_no_allocation', (
      SELECT count(*) FROM transactions t
      WHERE t.status='success' AND t.type='contribution'
        AND NOT EXISTS (SELECT 1 FROM payment_allocations pa WHERE pa.reference = t.reference))
  ),

  -- ── Payout model ────────────────────────────────────────────────────────
  'payout_model', jsonb_build_object(
    'by_status', (SELECT COALESCE(jsonb_object_agg(status::text, n), '{}'::jsonb)
                  FROM (SELECT status, count(*) n FROM payouts GROUP BY status) s),
    'memberships_missing_payout_date', (
      SELECT count(*) FROM group_memberships WHERE status='active' AND payout_date IS NULL),
    'memberships_missing_payout_amount', (
      SELECT count(*) FROM group_memberships WHERE status='active' AND COALESCE(payout_amount,0)=0),
    -- Does the membership's stored payout disagree with the group's cashout?
    -- (v11/v12/v15 reintroduced a formula fallback — F-12.)
    'payout_amount_vs_group_cashout_mismatch', (
      SELECT count(*) FROM group_memberships gm
      JOIN susu_groups g ON g.id = gm.group_id
      WHERE gm.status='active' AND g.cashout_amount IS NOT NULL
        AND gm.payout_amount IS NOT NULL
        AND abs(gm.payout_amount - (g.cashout_amount * COALESCE(gm.slot_fraction,1))) > 0.01),
    'groups_with_null_cashout', (
      SELECT count(*) FROM susu_groups WHERE cashout_amount IS NULL),
    -- payouts row disagreeing with its membership
    'payout_row_amount_mismatch', (
      SELECT count(*) FROM payouts p
      JOIN group_memberships gm ON gm.id = p.membership_id
      WHERE p.status='upcoming' AND gm.payout_amount IS NOT NULL
        AND abs(p.total_amount - gm.payout_amount) > 0.01),
    'duplicate_positions_in_group', (
      SELECT count(*) FROM (
        SELECT group_id, payout_position FROM group_memberships WHERE status='active'
        GROUP BY group_id, payout_position HAVING count(*) > 1) d)
  ),

  -- ── Registration (F-16: activation without payment) ─────────────────────
  'registration_model', jsonb_build_object(
    'by_status', (SELECT COALESCE(jsonb_object_agg(status::text, n), '{}'::jsonb)
                  FROM (SELECT status, count(*) n FROM kyc_applications GROUP BY status) s),
    'approved_but_fee_unpaid', (
      SELECT count(*) FROM kyc_applications
      WHERE status='approved' AND COALESCE(registration_fee_paid,false) = false),
    'approved_fee_unpaid_value', (
      SELECT COALESCE(sum(registration_fee_amount),0) FROM kyc_applications
      WHERE status='approved' AND COALESCE(registration_fee_paid,false) = false),
    'active_members_from_unpaid_registration', (
      SELECT count(*) FROM kyc_applications k
      JOIN members m ON m.id = k.created_member_id
      WHERE k.status='approved' AND COALESCE(k.registration_fee_paid,false)=false
        AND m.status='active')
  ),

  -- ── Timezone sanity (flag_late uses CURRENT_TIME vs payment_deadline) ───
  'time', jsonb_build_object(
    'db_timezone', current_setting('TimeZone'),
    'db_now', now(),
    'db_current_date', current_date,
    'db_current_time', current_time::text
  )

)) AS financial_forensics;
