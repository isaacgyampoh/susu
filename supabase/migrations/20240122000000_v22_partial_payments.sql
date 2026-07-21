-- ============================================================
-- V22 — PARTIAL (BIT-BY-BIT) PAYMENTS
-- ============================================================
-- A member paying toward a weekly/large contribution in small instalments
-- until the due amount is reached. amount_paid accumulates; the contribution
-- flips to 'paid' only when amount_paid covers amount. Existing rows are
-- backfilled: paid ones count as fully paid.

ALTER TABLE contributions
  ADD COLUMN IF NOT EXISTS amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0;

UPDATE contributions
SET amount_paid = amount
WHERE status = 'paid' AND amount_paid = 0;

-- Record an instalment toward a contribution. Returns the new paid-so-far and
-- whether it is now fully settled. Safe for over-payment (caps at amount).
CREATE OR REPLACE FUNCTION record_partial_payment(
  p_contribution_id UUID,
  p_amount DECIMAL,
  p_method TEXT DEFAULT 'cash',
  p_note TEXT DEFAULT NULL
) RETURNS TABLE (paid_so_far DECIMAL, fully_paid BOOLEAN, amount_due DECIMAL)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_c contributions%ROWTYPE;
  v_new DECIMAL;
  v_done BOOLEAN;
BEGIN
  SELECT * INTO v_c FROM contributions WHERE id = p_contribution_id;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'Contribution not found'; END IF;

  v_new  := LEAST(v_c.amount, COALESCE(v_c.amount_paid, 0) + p_amount);
  v_done := v_new >= v_c.amount - 0.001;

  UPDATE contributions
  SET amount_paid = v_new,
      status = CASE WHEN v_done THEN 'paid' ELSE status END,
      paid_at = CASE WHEN v_done THEN NOW() ELSE paid_at END,
      payment_method = COALESCE(p_method, payment_method),
      payment_note = COALESCE(p_note, payment_note)
  WHERE id = p_contribution_id;

  RETURN QUERY SELECT v_new, v_done, v_c.amount;
END;
$$;
