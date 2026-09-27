-- The caller needs the FIRST instalment's real amount, not total ÷ count.
-- Dividing in the caller is float arithmetic on money, and it is wrong anyway:
-- the last instalment absorbs the rounding, so the quotient is not what any
-- particular payment is.
CREATE OR REPLACE FUNCTION create_purchase(
  p_member_id UUID, p_plan_id UUID, p_start_date DATE DEFAULT CURRENT_DATE
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_plan payment_plans%ROWTYPE; v_product products%ROWTYPE;
  v_purchase purchases%ROWTYPE; v_ref TEXT; v_i INTEGER;
  v_amount DECIMAL(10,2); v_running DECIMAL(10,2) := 0; v_sched DECIMAL(10,2);
  v_first DECIMAL(10,2); v_first_due DATE;
BEGIN
  SELECT * INTO v_plan FROM payment_plans WHERE id = p_plan_id;
  IF v_plan.id IS NULL THEN RAISE EXCEPTION 'That payment plan does not exist' USING ERRCODE='no_data_found'; END IF;
  IF NOT v_plan.is_active THEN RAISE EXCEPTION 'That payment plan is no longer offered'; END IF;
  IF v_plan.available_from IS NOT NULL AND p_start_date < v_plan.available_from THEN
    RAISE EXCEPTION 'That plan opens on %', v_plan.available_from; END IF;
  IF v_plan.available_to IS NOT NULL AND p_start_date > v_plan.available_to THEN
    RAISE EXCEPTION 'That plan closed on %', v_plan.available_to; END IF;

  SELECT * INTO v_product FROM products WHERE id = v_plan.product_id;
  IF v_product.id IS NULL THEN RAISE EXCEPTION 'That product does not exist' USING ERRCODE='no_data_found'; END IF;
  IF v_product.status <> 'published' THEN RAISE EXCEPTION '"%" is not on sale', v_product.name; END IF;
  IF v_product.stock_quantity IS NOT NULL AND v_product.stock_quantity <= 0 THEN
    RAISE EXCEPTION '"%" is out of stock', v_product.name; END IF;
  IF NOT EXISTS (SELECT 1 FROM members WHERE id = p_member_id) THEN
    RAISE EXCEPTION 'No such customer' USING ERRCODE='no_data_found'; END IF;

  v_ref := 'PUR-' || upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 10));

  INSERT INTO purchases (
    reference, member_id, product_id, plan_id, product_name, plan_name,
    cash_price, total_payable, installment_amount, deposit_amount,
    duration_count, frequency, status, fulfilment_status, started_on
  ) VALUES (
    v_ref, p_member_id, v_product.id, v_plan.id, v_product.name, v_plan.name,
    v_product.cash_price, v_plan.total_payable, v_plan.installment_amount,
    v_plan.deposit_amount, v_plan.duration_count, v_plan.frequency,
    'pending', 'not_ready', p_start_date
  ) RETURNING * INTO v_purchase;

  v_sched := v_plan.total_payable - v_plan.deposit_amount;

  FOR v_i IN 1..v_plan.duration_count LOOP
    IF v_i < v_plan.duration_count THEN
      v_amount := ROUND(v_sched / v_plan.duration_count, 2);
      v_running := v_running + v_amount;
    ELSE
      v_amount := v_sched - v_running;
    END IF;
    IF v_i = 1 THEN v_first := v_amount; END IF;
    INSERT INTO purchase_installments (purchase_id, sequence, amount, due_date)
    VALUES (v_purchase.id, v_i, v_amount,
            installment_due_date(p_start_date, v_plan.frequency, v_i));
  END LOOP;

  IF v_product.stock_quantity IS NOT NULL THEN
    UPDATE products SET stock_quantity = stock_quantity - 1 WHERE id = v_product.id;
  END IF;

  v_first_due := installment_due_date(p_start_date, v_plan.frequency, 1);

  RETURN jsonb_build_object(
    'purchase_id', v_purchase.id, 'reference', v_purchase.reference,
    'product', v_product.name, 'plan', v_plan.name,
    'total', v_plan.total_payable, 'installments', v_plan.duration_count,
    'first_amount', v_first, 'first_due', v_first_due,
    'deposit', v_plan.deposit_amount);
END $fn$;

REVOKE ALL ON FUNCTION create_purchase(UUID,UUID,DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_purchase(UUID,UUID,DATE) TO service_role;
