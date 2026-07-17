-- ============================================================
-- 07 — The registration fee is commission, not part of the cashout
-- ============================================================
-- It was being ADDED to what a member collects, both on screen and in the
-- payout arithmetic. It is the operator's commission: it stays with the
-- operator and must never appear in a member's figure.
--
-- Left unfixed this pays out registration_fee more than intended to every
-- member, every cycle.

-- The flag no longer means anything. Default it off and keep it only so the
-- column does not vanish under anything still selecting it.
ALTER TABLE susu_groups ALTER COLUMN reg_fee_to_cashout SET DEFAULT false;
UPDATE susu_groups SET reg_fee_to_cashout = false;

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

  SELECT
    COALESCE(SUM(CASE WHEN status IN ('pending','overdue') THEN amount ELSE 0 END), 0),
    COUNT(CASE WHEN status = 'paid' THEN 1 END),
    COUNT(*)
  INTO v_out_c, v_paid, v_due
  FROM contributions
  WHERE member_id = v_payout.member_id
    AND group_id  = v_payout.group_id
    AND due_date <= v_payout.scheduled_date;

  SELECT COALESCE(SUM(amount), 0) INTO v_out_p
  FROM payment_penalties
  WHERE member_id = v_payout.member_id
    AND group_id  = v_payout.group_id
    AND NOT is_paid;

  -- The registration fee is commission. It is NOT added here.
  v_net := v_payout.total_amount - v_out_c - v_out_p;

  IF v_out_c > 0 THEN
    v_eligible := false;
    v_reason := 'Member has GHS ' || v_out_c::TEXT || ' in unpaid contributions due before payout date';
  ELSIF v_out_p > 0 THEN
    v_eligible := true;
    v_reason := 'Eligible — GHS ' || v_out_p::TEXT || ' in penalties will be deducted';
  END IF;

  RETURN QUERY SELECT
    v_eligible, v_reason, v_payout.total_amount, v_out_c, v_out_p,
    COALESCE(v_group.registration_fee, 0),   -- shown for reference only
    v_net, v_paid, v_due;
END;
$$;
