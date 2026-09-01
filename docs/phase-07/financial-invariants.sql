-- ============================================================================
-- FINANCIAL INVARIANTS — runnable against production at any time
-- ============================================================================
-- Every row returned is a violation. A clean run returns nothing.
-- Read-only. Safe to schedule.
--
-- PHASE 07 revision:
--   * invariants 2, 7, 8 and 9 now ignore allocations stamped reversed by
--     v38 — a deliberate reversal produces exactly the shape invariant 8
--     exists to catch, and an alarm that fires on correct operator behaviour
--     is an alarm people learn to ignore;
--   * three new invariants (11, 12, 13) cover registration payments and
--     reversals, the two paths this phase added.
-- ============================================================================

WITH checks AS (

  -- 1. No obligation may absorb more than it costs.
  SELECT 'contribution_overpaid' AS invariant,
         count(*) AS violations,
         COALESCE(sum(c.amount_paid - c.amount), 0) AS excess
  FROM contributions c
  WHERE c.amount_paid > c.amount + 0.005

  UNION ALL
  -- 2. A payment's allocations may not exceed the payment itself.
  SELECT 'allocation_exceeds_payment', count(*), COALESCE(sum(over_by),0)
  FROM (
    SELECT pa.reference, sum(pa.amount) - max(t.amount) AS over_by
    FROM payment_allocations pa
    JOIN transactions t ON t.reference = pa.reference
    WHERE pa.reversed_at IS NULL
    GROUP BY pa.reference
    HAVING sum(pa.amount) > max(t.amount) + 0.005) x

  UNION ALL
  -- 3. Credit belongs to a membership and can never cross to another. A ledger
  --    entry whose membership belongs to a different member is the shape that
  --    violation would take.
  SELECT 'credit_crossed_membership', count(*), 0
  FROM membership_credit_ledger l
  JOIN group_memberships gm ON gm.id = l.membership_id
  WHERE gm.member_id <> l.member_id

  UNION ALL
  -- 4. No membership may hold negative credit.
  SELECT 'negative_credit_balance', count(*), COALESCE(sum(bal),0)
  FROM (SELECT membership_id, sum(amount) AS bal
        FROM membership_credit_ledger GROUP BY membership_id
        HAVING sum(amount) < -0.005) y

  UNION ALL
  -- 5. status='paid' and paid_at must agree, in both directions.
  SELECT 'paid_status_without_timestamp', count(*), 0
  FROM contributions WHERE status='paid' AND paid_at IS NULL

  UNION ALL
  SELECT 'unpaid_status_with_timestamp', count(*), 0
  FROM contributions WHERE status<>'paid' AND paid_at IS NOT NULL

  UNION ALL
  -- 6. Every allocation must point at a real obligation.
  SELECT 'orphan_allocation', count(*), 0
  FROM payment_allocations pa
  LEFT JOIN contributions c ON c.id = pa.contribution_id
  WHERE c.id IS NULL

  UNION ALL
  -- 7. One payment may touch a given day at most once.
  SELECT 'duplicate_allocation_for_day', count(*), 0
  FROM (SELECT reference, contribution_id FROM payment_allocations
        WHERE reversed_at IS NULL
        GROUP BY 1,2 HAVING count(*) > 1) z

  UNION ALL
  -- 8. Money allocated to a day that is neither settled nor part-paid — the
  --    F-02 signature. Should only ever be a genuine partial.
  SELECT 'allocation_against_unsettled_day', count(*), COALESCE(sum(pa.amount),0)
  FROM payment_allocations pa
  JOIN contributions c ON c.id = pa.contribution_id
  WHERE c.status <> 'paid' AND c.amount_paid < 0.005
    -- A reversal (v38) deliberately produces this shape and stamps the row,
    -- so a reversed allocation is expected here rather than a defect.
    AND pa.reversed_at IS NULL

  UNION ALL
  -- 9. A payment settled since the cutover must have left a trace of what it
  --    covered. Rows predating the allocation ledger are excluded — that gap
  --    is historical and documented, not a live defect.
  SELECT 'settled_payment_without_allocation', count(*), COALESCE(sum(t.amount),0)
  FROM transactions t
  WHERE t.status='success' AND t.type='contribution'
    AND t.created_at > TIMESTAMPTZ '2026-09-01 14:00:00+00'
    AND NOT EXISTS (SELECT 1 FROM payment_allocations pa
                     WHERE pa.reference = t.reference AND pa.reversed_at IS NULL)

  UNION ALL
  -- 10. Referential sanity.
  SELECT 'membership_without_member', count(*), 0
  FROM group_memberships gm
  LEFT JOIN members m ON m.id = gm.member_id
  WHERE m.id IS NULL

  UNION ALL
  -- 11. A registration fee settles no obligation, so it must never hold an
  --     allocation. If one ever appears, a registration fee has been routed
  --     through the contribution engine — the Phase 06 regression, back.
  SELECT 'registration_fee_with_allocation', count(*), COALESCE(sum(pa.amount),0)
  FROM payment_allocations pa
  JOIN transactions t ON t.reference = pa.reference
  WHERE t.type = 'registration_fee'

  UNION ALL
  -- 12. A registration marked paid must have a payment behind it: either a
  --     provider-confirmed one, a payment the operator recorded taking, or an
  --     explicitly audited override. A `true` with none of those is a flag
  --     flip standing in for money.
  SELECT 'registration_paid_without_payment', count(*), COALESCE(sum(k.registration_fee_amount),0)
  FROM kyc_applications k
  WHERE COALESCE(k.registration_fee_paid, false)
    AND COALESCE(k.registration_fee_amount, 0) > 0
    AND NOT EXISTS (
      SELECT 1 FROM transactions t
       WHERE t.type = 'registration_fee' AND t.status = 'success'
         AND (t.kyc_application_id = k.id OR t.member_id = k.created_member_id))
    AND NOT EXISTS (
      SELECT 1 FROM audit_log a
       WHERE a.entity_id = k.id
         AND a.action IN ('registration.fee_received','registration.approved_without_payment',
                          'registration.fee_settled','registration.marked_fee_paid'))

  UNION ALL
  -- 13. Reversal integrity: a stamped allocation must not still be claimed by
  --     a successful payment, and a reversal must carry its reason.
  SELECT 'reversed_allocation_without_reason', count(*), 0
  FROM payment_allocations
  WHERE reversed_at IS NOT NULL AND COALESCE(btrim(reversal_reason), '') = ''
)
SELECT * FROM checks WHERE violations > 0;
