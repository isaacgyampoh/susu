-- ============================================================================
-- V58 — CREATING A PURCHASE, AND PAYING IT DOWN
-- ============================================================================
-- Two functions carry the money: one creates a purchase and its schedule, one
-- applies a confirmed payment to it. Everything else reads.
--
-- Both are SECURITY DEFINER and revoked from anon and authenticated, like every
-- other financial function here. They are reachable only through an edge
-- function holding the service role, which is where the caller's identity is
-- actually established.
-- ============================================================================

-- ── The due date of instalment N ────────────────────────────────────────────
-- Its own function so the schedule, the projections and any future reminder
-- all step dates the same way. Four frequencies, one place.

CREATE OR REPLACE FUNCTION installment_due_date(
  p_start DATE, p_frequency plan_frequency, p_sequence INTEGER
) RETURNS DATE
LANGUAGE sql IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_frequency
    WHEN 'daily'    THEN p_start + (p_sequence - 1)
    WHEN 'weekly'   THEN p_start + ((p_sequence - 1) * 7)
    WHEN 'biweekly' THEN p_start + ((p_sequence - 1) * 14)
    WHEN 'monthly'  THEN (p_start + ((p_sequence - 1) || ' months')::interval)::date
  END;
$$;

-- ============================================================================
-- CREATE A PURCHASE
-- ============================================================================
-- Snapshots the plan, writes the schedule, returns the purchase.
--
-- ── WHY THE SCHEDULE IS BUILT HERE ──────────────────────────────────────────
-- §13: generated from the plan, never typed in row by row. A schedule assembled
-- in the browser is a schedule that can be assembled differently next time, and
-- the difference is somebody's money.
--
-- ── THE LAST INSTALMENT ABSORBS THE ROUNDING ────────────────────────────────
-- GHS 4,000 over 3 payments is 1,333.33 three times, which is 3,999.99. The
-- final instalment carries the difference so the schedule sums to exactly
-- total_payable. Without that the customer pays everything and still owes a
-- pesewa, and the purchase never completes.
-- ============================================================================

CREATE OR REPLACE FUNCTION create_purchase(
  p_member_id  UUID,
  p_plan_id    UUID,
  p_start_date DATE DEFAULT CURRENT_DATE
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan     payment_plans%ROWTYPE;
  v_product  products%ROWTYPE;
  v_purchase purchases%ROWTYPE;
  v_ref      TEXT;
  v_i        INTEGER;
  v_amount   DECIMAL(10,2);
  v_running  DECIMAL(10,2) := 0;
  v_sched    DECIMAL(10,2);
BEGIN
  SELECT * INTO v_plan FROM payment_plans WHERE id = p_plan_id;
  IF v_plan.id IS NULL THEN
    RAISE EXCEPTION 'That payment plan does not exist' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT v_plan.is_active THEN
    RAISE EXCEPTION 'That payment plan is no longer offered';
  END IF;
  IF v_plan.available_from IS NOT NULL AND p_start_date < v_plan.available_from THEN
    RAISE EXCEPTION 'That plan opens on %', v_plan.available_from;
  END IF;
  IF v_plan.available_to IS NOT NULL AND p_start_date > v_plan.available_to THEN
    RAISE EXCEPTION 'That plan closed on %', v_plan.available_to;
  END IF;

  SELECT * INTO v_product FROM products WHERE id = v_plan.product_id;
  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'That product does not exist' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_product.status <> 'published' THEN
    RAISE EXCEPTION '"%" is not on sale', v_product.name;
  END IF;
  IF v_product.stock_quantity IS NOT NULL AND v_product.stock_quantity <= 0 THEN
    RAISE EXCEPTION '"%" is out of stock', v_product.name;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM members WHERE id = p_member_id) THEN
    RAISE EXCEPTION 'No such customer' USING ERRCODE = 'no_data_found';
  END IF;

  v_ref := 'PUR-' || upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 10));

  /* The snapshot. Every money column is copied, not referenced — see the v57
     header. product_id and plan_id go in beside them for display only. */
  INSERT INTO purchases (
    reference, member_id, product_id, plan_id,
    product_name, plan_name, cash_price, total_payable,
    installment_amount, deposit_amount, duration_count, frequency,
    status, fulfilment_status, started_on
  ) VALUES (
    v_ref, p_member_id, v_product.id, v_plan.id,
    v_product.name, v_plan.name, v_product.cash_price, v_plan.total_payable,
    v_plan.installment_amount, v_plan.deposit_amount, v_plan.duration_count,
    v_plan.frequency,
    'pending', 'not_ready', p_start_date
  )
  RETURNING * INTO v_purchase;

  -- The schedule. The deposit is not an instalment: it is due immediately and
  -- is settled like any other payment against instalment 1 onwards.
  v_sched := v_plan.total_payable - v_plan.deposit_amount;

  FOR v_i IN 1..v_plan.duration_count LOOP
    IF v_i < v_plan.duration_count THEN
      v_amount := ROUND(v_sched / v_plan.duration_count, 2);
      v_running := v_running + v_amount;
    ELSE
      v_amount := v_sched - v_running;   -- absorbs the rounding, exactly
    END IF;

    INSERT INTO purchase_installments (purchase_id, sequence, amount, due_date)
    VALUES (v_purchase.id, v_i, v_amount,
            installment_due_date(p_start_date, v_plan.frequency, v_i));
  END LOOP;

  IF v_product.stock_quantity IS NOT NULL THEN
    UPDATE products SET stock_quantity = stock_quantity - 1 WHERE id = v_product.id;
  END IF;

  RETURN jsonb_build_object(
    'purchase_id', v_purchase.id,
    'reference',   v_purchase.reference,
    'product',     v_product.name,
    'plan',        v_plan.name,
    'total',       v_plan.total_payable,
    'installments',v_plan.duration_count,
    'first_due',   installment_due_date(p_start_date, v_plan.frequency, 1)
  );
END $$;

REVOKE ALL ON FUNCTION create_purchase(UUID,UUID,DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_purchase(UUID,UUID,DATE) TO service_role;

-- ============================================================================
-- APPLY A CONFIRMED PAYMENT TO A PURCHASE
-- ============================================================================
-- §15's chain ends here: the provider confirmed, the transaction is recorded,
-- and this is the step that moves the balance.
--
-- ── IDEMPOTENT, BECAUSE CALLBACKS ARRIVE TWICE ──────────────────────────────
-- NaloPay can deliver the same webhook more than once, and a retry after a
-- timeout looks identical to a fresh payment. The reference is the identity of
-- the money: if this reference has already been allocated, this returns what it
-- did the first time and changes nothing. The transaction row is locked FOR
-- UPDATE so two simultaneous callbacks cannot both pass that check.
--
-- ── IT NEVER INVENTS A CONFIRMATION ─────────────────────────────────────────
-- It refuses a transaction that is not already `success`. Marking money
-- received is the payment layer's job, done against the provider; this function
-- only distributes money the provider has already confirmed.
-- ============================================================================

CREATE OR REPLACE FUNCTION settle_purchase_payment(
  p_reference   TEXT,
  p_purchase_id UUID
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tx        transactions%ROWTYPE;
  v_purchase  purchases%ROWTYPE;
  v_inst      RECORD;
  v_left      DECIMAL(10,2);
  v_take      DECIMAL(10,2);
  v_applied   DECIMAL(10,2) := 0;
  v_settled   INTEGER := 0;
  v_balance   DECIMAL(10,2);
  v_now       TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_tx FROM transactions WHERE reference = p_reference FOR UPDATE;
  IF v_tx.id IS NULL THEN
    RAISE EXCEPTION 'No payment with reference %', p_reference USING ERRCODE = 'no_data_found';
  END IF;

  -- Already applied. Report the earlier outcome; change nothing.
  IF EXISTS (SELECT 1 FROM payment_allocations
              WHERE reference = p_reference AND reversed_at IS NULL) THEN
    SELECT COALESCE(sum(amount),0) INTO v_applied
      FROM payment_allocations WHERE reference = p_reference AND reversed_at IS NULL;
    RETURN jsonb_build_object('duplicate', true, 'applied', v_applied,
                              'reference', p_reference);
  END IF;

  IF v_tx.status <> 'success' THEN
    RAISE EXCEPTION 'Payment % is %, not success — nothing may be applied from it',
      p_reference, v_tx.status;
  END IF;

  SELECT * INTO v_purchase FROM purchases WHERE id = p_purchase_id FOR UPDATE;
  IF v_purchase.id IS NULL THEN
    RAISE EXCEPTION 'No such purchase' USING ERRCODE = 'no_data_found';
  END IF;
  -- The payment belongs to the person whose purchase this is.
  IF v_purchase.member_id <> v_tx.member_id THEN
    RAISE EXCEPTION 'That payment was not made by the holder of this purchase';
  END IF;
  IF v_purchase.status IN ('cancelled','refunded') THEN
    RAISE EXCEPTION 'This purchase is % and cannot take payments', v_purchase.status;
  END IF;

  v_left := v_tx.amount;

  -- Oldest instalment first. A customer paying GHS 1,000 against GHS 500
  -- instalments clears two, and the order is by sequence so the schedule fills
  -- from the front rather than wherever a scan happened to land.
  FOR v_inst IN
    SELECT * FROM purchase_installments
    WHERE purchase_id = p_purchase_id AND status IN ('pending','overdue')
    ORDER BY sequence
    FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0.004;

    v_take := LEAST(v_left, v_inst.amount - v_inst.amount_paid);
    EXIT WHEN v_take <= 0.004;

    IF v_inst.amount_paid + v_take >= v_inst.amount - 0.004 THEN
      UPDATE purchase_installments
      SET status = 'paid', paid_at = v_now, amount_paid = v_inst.amount
      WHERE id = v_inst.id;
      v_settled := v_settled + 1;
    ELSE
      UPDATE purchase_installments
      SET amount_paid = v_inst.amount_paid + v_take
      WHERE id = v_inst.id;
    END IF;

    INSERT INTO payment_allocations
      (reference, member_id, installment_id, purchase_id, amount, kind, due_date)
    VALUES
      (p_reference, v_purchase.member_id, v_inst.id, p_purchase_id, v_take,
       CASE WHEN v_inst.amount_paid + v_take >= v_inst.amount - 0.004
            THEN 'installment' ELSE 'installment_part' END,
       v_inst.due_date);

    v_left    := v_left - v_take;
    v_applied := v_applied + v_take;
  END LOOP;

  -- What remains after the last instalment. Recorded, never silently dropped:
  -- §28 requires overpayment to be defined rather than miscalculated away.
  IF v_left > 0.004 THEN
    INSERT INTO settlement_log (reference, event, member_id, amount, detail)
    VALUES (p_reference, 'purchase_overpayment', v_purchase.member_id, v_left,
            jsonb_build_object('purchase_id', p_purchase_id,
                               'note', 'Paid beyond the purchase total; held for the operator to refund or apply.'));
  END IF;

  SELECT COALESCE(sum(amount - amount_paid), 0) INTO v_balance
    FROM purchase_installments
   WHERE purchase_id = p_purchase_id AND status <> 'waived';

  UPDATE purchases
  SET status = CASE WHEN v_balance <= 0.004 THEN 'fully_paid'::purchase_status
                    ELSE 'active'::purchase_status END,
      fulfilment_status = CASE
        WHEN v_balance <= 0.004 AND fulfilment_status = 'not_ready'
          THEN 'ready'::fulfilment_status
        ELSE fulfilment_status END,
      completed_at = CASE WHEN v_balance <= 0.004 THEN COALESCE(completed_at, v_now)
                          ELSE completed_at END
  WHERE id = p_purchase_id;

  -- The moment it became collectable, in the history that gets read months on.
  IF v_balance <= 0.004 THEN
    INSERT INTO purchase_fulfilments (purchase_id, status, note)
    SELECT p_purchase_id, 'ready', 'Balance reached zero'
    WHERE NOT EXISTS (SELECT 1 FROM purchase_fulfilments
                       WHERE purchase_id = p_purchase_id AND status = 'ready');
  END IF;

  RETURN jsonb_build_object(
    'duplicate', false,
    'applied', v_applied,
    'installments_settled', v_settled,
    'balance', v_balance,
    'fully_paid', v_balance <= 0.004,
    'overpaid_by', GREATEST(v_left, 0)
  );
END $$;

REVOKE ALL ON FUNCTION settle_purchase_payment(TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION settle_purchase_payment(TEXT,UUID) TO service_role;

-- ── Overdue marking, for the reminder cron ──────────────────────────────────
-- A pure status catch-up: an instalment past its date that nobody has paid.
-- It moves no money and asserts nothing about the provider.

CREATE OR REPLACE FUNCTION mark_overdue_installments()
RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH moved AS (
    UPDATE purchase_installments
    SET status = 'overdue'
    WHERE status = 'pending' AND due_date < CURRENT_DATE
    RETURNING 1)
  SELECT count(*)::int FROM moved;
$$;

REVOKE ALL ON FUNCTION mark_overdue_installments() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION mark_overdue_installments() TO service_role;
