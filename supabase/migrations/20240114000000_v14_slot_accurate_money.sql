-- ============================================================
-- V14 — SLOT-ACCURATE MONEY MATHS
-- ============================================================
-- With multiple slots per member in one group (v13), anything that
-- aggregates contributions by member+group mixes the slots together:
-- each plan card would show the combined balance of all slots, and one
-- slot's unpaid days would be deducted from EVERY slot's payout —
-- double-counting arrears. Contributions therefore aggregate per
-- MEMBERSHIP (per slot).
--
-- Penalties stay member+group scoped: the release flow marks them paid
-- on the first payout, so they cannot double-deduct.

-- ── Per-slot payout eligibility ──
DROP FUNCTION IF EXISTS check_payout_eligibility(UUID);

CREATE FUNCTION check_payout_eligibility(p_payout_id UUID)
RETURNS TABLE (
  eligible            BOOLEAN,
  reason              TEXT,
  gross_amount        DECIMAL,
  outstanding_contrib DECIMAL,
  outstanding_penalty DECIMAL,
  registration_fee    DECIMAL,   -- reported for the record, never added
  net_amount          DECIMAL,
  contributions_paid  INTEGER,
  contributions_due   INTEGER
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_payout   payouts%ROWTYPE;
  v_group    susu_groups%ROWTYPE;
  v_out_c    DECIMAL := 0;
  v_out_p    DECIMAL := 0;
  v_paid     INTEGER := 0;
  v_due      INTEGER := 0;
  v_net      DECIMAL := 0;
  v_eligible BOOLEAN := true;
  v_reason   TEXT := 'Member is eligible for payout';
BEGIN
  SELECT * INTO v_payout FROM payouts WHERE id = p_payout_id;
  IF v_payout.id IS NULL THEN
    RETURN QUERY SELECT false, 'Payout not found'::TEXT, 0::DECIMAL, 0::DECIMAL, 0::DECIMAL, 0::DECIMAL, 0::DECIMAL, 0, 0;
    RETURN;
  END IF;

  SELECT * INTO v_group FROM susu_groups WHERE id = v_payout.group_id;

  -- Contributions for THIS slot only (fall back to member+group for any
  -- legacy payout row without a membership link)
  SELECT
    COALESCE(SUM(CASE WHEN status IN ('pending','overdue') THEN amount ELSE 0 END), 0),
    COUNT(CASE WHEN status = 'paid' THEN 1 END),
    COUNT(*)
  INTO v_out_c, v_paid, v_due
  FROM contributions
  WHERE (
      (v_payout.membership_id IS NOT NULL AND membership_id = v_payout.membership_id)
      OR
      (v_payout.membership_id IS NULL AND member_id = v_payout.member_id AND group_id = v_payout.group_id)
    )
    AND due_date <= v_payout.scheduled_date;

  -- Penalties: member+group; the release flow settles them so they only
  -- ever deduct once, on the first payout
  SELECT COALESCE(SUM(amount), 0) INTO v_out_p
  FROM payment_penalties
  WHERE member_id = v_payout.member_id
    AND group_id  = v_payout.group_id
    AND NOT is_paid;

  -- The registration fee is commission. It is NOT added here.
  v_net := v_payout.total_amount - v_out_c - v_out_p;

  IF v_out_c > 0 THEN
    v_eligible := false;
    v_reason := 'This slot has GHS ' || v_out_c::TEXT || ' in unpaid contributions due before its payout date';
  ELSIF v_out_p > 0 THEN
    v_eligible := true;
    v_reason := 'Eligible — GHS ' || v_out_p::TEXT || ' in penalties will be deducted';
  END IF;

  RETURN QUERY SELECT
    v_eligible, v_reason, v_payout.total_amount, v_out_c, v_out_p,
    COALESCE(v_group.registration_fee, 0),
    v_net, v_paid, v_due;
END;
$$;

-- ── Per-slot balance for the member portal ──
CREATE OR REPLACE FUNCTION get_membership_balance(p_membership_id UUID)
RETURNS TABLE (
  total_paid          DECIMAL,
  total_remaining     DECIMAL,
  total_overdue       DECIMAL,
  penalty_balance     DECIMAL,
  contributions_paid  INTEGER,
  contributions_total INTEGER
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE WHEN c.status = 'paid'    THEN c.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN c.status IN ('pending','overdue') THEN c.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN c.status = 'overdue' THEN c.amount ELSE 0 END), 0),
    COALESCE((SELECT SUM(p.amount) FROM payment_penalties p
              JOIN contributions pc ON pc.id = p.contribution_id
              WHERE pc.membership_id = p_membership_id AND NOT p.is_paid), 0),
    COUNT(CASE WHEN c.status = 'paid' THEN 1 END)::INTEGER,
    COUNT(*)::INTEGER
  FROM contributions c
  WHERE c.membership_id = p_membership_id;
END;
$$;
