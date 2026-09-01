-- ============================================================================
-- FINANCIAL CHECKSUM — run BEFORE and AFTER any migration, then diff.
-- ============================================================================
-- Row counts alone do not prove financial data was preserved: a migration can
-- keep every row and still move money. This captures the money itself —
-- per-status sums, per-group sums, and a content hash over the financial
-- columns of every contribution and allocation.
--
-- Read-only. Returns one JSON row.
-- ============================================================================
SELECT jsonb_pretty(jsonb_build_object(
  'captured_at', now(),

  'counts', jsonb_build_object(
    'members',             (SELECT count(*) FROM members),
    'susu_groups',         (SELECT count(*) FROM susu_groups),
    'group_memberships',   (SELECT count(*) FROM group_memberships),
    'contributions',       (SELECT count(*) FROM contributions),
    'transactions',        (SELECT count(*) FROM transactions),
    'payment_allocations', (SELECT count(*) FROM payment_allocations),
    'payouts',             (SELECT count(*) FROM payouts),
    'payment_penalties',   (SELECT count(*) FROM payment_penalties),
    'audit_log',           (SELECT count(*) FROM audit_log)
  ),

  -- Money, by state. These are the numbers a migration must not move.
  'money', jsonb_build_object(
    'contributions_amount_total',      (SELECT COALESCE(sum(amount),0)      FROM contributions),
    'contributions_amount_paid_total', (SELECT COALESCE(sum(amount_paid),0) FROM contributions),
    'contributions_paid_amount',       (SELECT COALESCE(sum(amount),0) FROM contributions WHERE status='paid'),
    'contributions_pending_amount',    (SELECT COALESCE(sum(amount),0) FROM contributions WHERE status='pending'),
    'contributions_overdue_amount',    (SELECT COALESCE(sum(amount),0) FROM contributions WHERE status='overdue'),
    'transactions_success_amount',     (SELECT COALESCE(sum(amount),0) FROM transactions WHERE status='success'),
    'transactions_pending_amount',     (SELECT COALESCE(sum(amount),0) FROM transactions WHERE status='pending'),
    'allocations_amount_total',        (SELECT COALESCE(sum(amount),0) FROM payment_allocations),
    'payouts_paid_amount',             (SELECT COALESCE(sum(total_amount),0) FROM payouts WHERE status='paid'),
    'payouts_upcoming_amount',         (SELECT COALESCE(sum(total_amount),0) FROM payouts WHERE status='upcoming'),
    'penalties_unpaid_amount',         (SELECT COALESCE(sum(amount),0) FROM payment_penalties WHERE NOT is_paid),
    'member_credit_total',             (SELECT COALESCE(sum(credit_balance),0) FROM members)
  ),

  -- Content hashes. If any financial field of any row changes, these move.
  'hashes', jsonb_build_object(
    'contributions', (SELECT md5(string_agg(
        id::text||':'||amount::text||':'||COALESCE(amount_paid,0)::text||':'||status::text||
        ':'||COALESCE(paystack_ref,'')||':'||COALESCE(penalty_due,0)::text, '|' ORDER BY id))
      FROM contributions),
    'allocations',   (SELECT md5(string_agg(
        id::text||':'||amount::text||':'||COALESCE(contribution_id::text,'')||':'||reference, '|' ORDER BY id))
      FROM payment_allocations),
    'transactions',  (SELECT md5(string_agg(
        id::text||':'||amount::text||':'||status::text||':'||reference, '|' ORDER BY id))
      FROM transactions),
    'payouts',       (SELECT md5(string_agg(
        id::text||':'||total_amount::text||':'||status::text, '|' ORDER BY id))
      FROM payouts),
    'memberships',   (SELECT md5(string_agg(
        id::text||':'||COALESCE(payout_amount,0)::text||':'||COALESCE(payout_date::text,'')||
        ':'||status::text||':'||COALESCE(slot_fraction,1)::text, '|' ORDER BY id))
      FROM group_memberships)
  ),

  -- Per-group money, so a regression can be located rather than just detected.
  'by_group', (SELECT COALESCE(jsonb_object_agg(name, totals), '{}'::jsonb) FROM (
      SELECT g.name, jsonb_build_object(
        'expected',  COALESCE(sum(c.amount),0),
        'paid',      COALESCE(sum(c.amount) FILTER (WHERE c.status='paid'),0),
        'members',   count(DISTINCT c.membership_id)
      ) AS totals
      FROM susu_groups g LEFT JOIN contributions c ON c.group_id = g.id
      GROUP BY g.name) x)
)) AS financial_checksum;
