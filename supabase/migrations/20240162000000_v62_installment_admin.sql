-- ============================================================================
-- V62 — THE COLLECTOR'S SIDE OF INSTALMENTS
-- ============================================================================
-- Submitting a request, turning one into an agreement, creating an agreement
-- for somebody who walked in off the street, and the figures the dashboard
-- reads. Every one of them writes through the same purchases/instalments
-- tables the website already uses.
-- ============================================================================

-- ── A CUSTOMER ASKS ─────────────────────────────────────────────────────────
-- Public. Takes ids and contact details and nothing else: the price, term and
-- deposit are read from the plan here, so a tampered request body cannot ask
-- for a television on terms nobody offered.

CREATE OR REPLACE FUNCTION submit_installment_request(
  p_plan_id   UUID,
  p_full_name TEXT,
  p_phone     TEXT,
  p_whatsapp  TEXT DEFAULT NULL,
  p_email     TEXT DEFAULT NULL,
  p_address   TEXT DEFAULT NULL,
  p_quantity  INTEGER DEFAULT 1,
  p_note      TEXT DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_plan payment_plans%ROWTYPE; v_product products%ROWTYPE; v_ref TEXT;
BEGIN
  IF length(btrim(COALESCE(p_full_name,''))) < 2 THEN
    RAISE EXCEPTION 'Please give your name';
  END IF;
  IF p_phone IS NULL OR length(regexp_replace(p_phone,'\D','','g')) < 9 THEN
    RAISE EXCEPTION 'Please give a phone number we can reach you on';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 1 THEN
    RAISE EXCEPTION 'Quantity must be at least 1';
  END IF;

  SELECT * INTO v_plan FROM payment_plans WHERE id = p_plan_id AND is_active;
  IF v_plan.id IS NULL THEN RAISE EXCEPTION 'That payment plan is not available'; END IF;

  SELECT * INTO v_product FROM products WHERE id = v_plan.product_id;
  IF v_product.id IS NULL OR v_product.status <> 'published' THEN
    RAISE EXCEPTION 'That product is not on sale';
  END IF;

  v_ref := 'REQ-' || upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 8));

  INSERT INTO installment_requests (
    reference, full_name, phone, whatsapp, email, address,
    product_id, plan_id, product_name, plan_name, quantity,
    cash_price, total_payable, deposit_amount, duration_count, frequency, note)
  VALUES (
    v_ref, btrim(p_full_name), p_phone, NULLIF(btrim(COALESCE(p_whatsapp,'')),''),
    NULLIF(btrim(COALESCE(p_email,'')),''), NULLIF(btrim(COALESCE(p_address,'')),''),
    v_product.id, v_plan.id, v_product.name, v_plan.name, p_quantity,
    v_product.cash_price, v_plan.total_payable * p_quantity,
    v_plan.deposit_amount * p_quantity, v_plan.duration_count, v_plan.frequency,
    NULLIF(btrim(COALESCE(p_note,'')),''));

  RETURN jsonb_build_object('reference', v_ref, 'product', v_product.name,
                            'plan', v_plan.name);
END $$;

REVOKE ALL ON FUNCTION submit_installment_request(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION submit_installment_request(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT)
  TO service_role;

-- ============================================================================
-- CREATING AN AGREEMENT
-- ============================================================================
-- One function for both doors — approving a request, and somebody walking into
-- the shop — because they produce exactly the same thing and writing them
-- separately is how the walk-in path ends up without a schedule.
--
-- ── THE TERMS ARE THE COLLECTOR'S, NOT THE CATALOGUE'S ──────────────────────
-- She may agree a different deposit or a longer term than the plan advertises;
-- that is what haggling is. So the terms are arguments, defaulted from the
-- plan where a plan exists. Whatever is passed is snapshotted onto the
-- purchase and never read from the catalogue again.
--
-- ── THE CUSTOMER GETS NO LOGIN ──────────────────────────────────────────────
-- A `members` row is created if the phone is new, with NO passcode. They exist
-- so payments have an owner and history has a name; they cannot sign in, and
-- nothing here issues them a way to. Phone is UNIQUE, so a returning customer
-- is the same person rather than a second record.
-- ============================================================================

CREATE OR REPLACE FUNCTION create_installment_agreement(
  p_admin_id       UUID,
  p_full_name      TEXT,
  p_phone          TEXT,
  p_product_id     UUID,
  p_total_payable  DECIMAL,
  p_deposit        DECIMAL,
  p_duration       INTEGER,
  p_frequency      plan_frequency DEFAULT 'monthly',
  p_plan_id        UUID DEFAULT NULL,
  p_plan_name      TEXT DEFAULT NULL,
  p_start_date     DATE DEFAULT CURRENT_DATE,
  p_request_id     UUID DEFAULT NULL,
  p_note           TEXT DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_member  members%ROWTYPE;
  v_product products%ROWTYPE;
  v_purchase purchases%ROWTYPE;
  v_ref TEXT; v_code TEXT; v_i INTEGER;
  v_sched DECIMAL(10,2); v_amount DECIMAL(10,2); v_running DECIMAL(10,2) := 0;
BEGIN
  IF p_total_payable IS NULL OR p_total_payable <= 0 THEN
    RAISE EXCEPTION 'The total payable must be more than zero'; END IF;
  IF p_duration IS NULL OR p_duration < 1 THEN
    RAISE EXCEPTION 'How many payments? At least one.'; END IF;
  IF COALESCE(p_deposit,0) < 0 OR COALESCE(p_deposit,0) >= p_total_payable THEN
    RAISE EXCEPTION 'The deposit must be less than the total'; END IF;

  SELECT * INTO v_product FROM products WHERE id = p_product_id;
  IF v_product.id IS NULL THEN
    RAISE EXCEPTION 'No such product' USING ERRCODE='no_data_found'; END IF;

  -- The customer. Existing phone wins, so one person stays one row.
  SELECT * INTO v_member FROM members WHERE phone = p_phone;
  IF v_member.id IS NULL THEN
    SELECT 'AW-' || lpad((COALESCE(max(substring(member_id from 4)::int),0)+1)::text, 4, '0')
      INTO v_code FROM members WHERE member_id ~ '^AW-\d+$';
    INSERT INTO members (member_id, full_name, phone, status, source)
    VALUES (COALESCE(v_code,'AW-0001'), btrim(p_full_name), p_phone, 'active', 'shop')
    RETURNING * INTO v_member;
  END IF;

  v_ref := 'PUR-' || upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 10));

  INSERT INTO purchases (
    reference, member_id, product_id, plan_id, product_name, plan_name,
    cash_price, total_payable, installment_amount, deposit_amount,
    duration_count, frequency, status, fulfilment_status, started_on, admin_notes)
  VALUES (
    v_ref, v_member.id, v_product.id, p_plan_id, v_product.name,
    COALESCE(p_plan_name, 'Agreed at the shop'),
    v_product.cash_price, p_total_payable,
    ROUND((p_total_payable - COALESCE(p_deposit,0)) / p_duration, 2),
    COALESCE(p_deposit,0), p_duration, p_frequency,
    'active', 'not_ready', p_start_date, p_note)
  RETURNING * INTO v_purchase;

  -- The schedule. Last instalment absorbs the rounding so the rows sum to
  -- exactly what was agreed; without it the customer pays everything and is
  -- left owing a pesewa for ever.
  v_sched := p_total_payable - COALESCE(p_deposit,0);
  FOR v_i IN 1..p_duration LOOP
    IF v_i < p_duration THEN
      v_amount := ROUND(v_sched / p_duration, 2); v_running := v_running + v_amount;
    ELSE
      v_amount := v_sched - v_running;
    END IF;
    INSERT INTO purchase_installments (purchase_id, sequence, amount, due_date)
    VALUES (v_purchase.id, v_i, v_amount,
            installment_due_date(p_start_date, p_frequency, v_i));
  END LOOP;

  IF v_product.stock_quantity IS NOT NULL THEN
    UPDATE products SET stock_quantity = GREATEST(stock_quantity - 1, 0)
     WHERE id = v_product.id;
  END IF;

  IF p_request_id IS NOT NULL THEN
    UPDATE installment_requests
       SET status='converted', purchase_id=v_purchase.id,
           decided_by=p_admin_id, decided_at=NOW()
     WHERE id = p_request_id;
  END IF;

  RETURN jsonb_build_object(
    'purchase_id', v_purchase.id, 'reference', v_ref,
    'member_id', v_member.id, 'customer', v_member.full_name,
    'product', v_product.name, 'total', p_total_payable,
    'installments', p_duration);
END $$;

REVOKE ALL ON FUNCTION create_installment_agreement(UUID,TEXT,TEXT,UUID,DECIMAL,DECIMAL,INTEGER,plan_frequency,UUID,TEXT,DATE,UUID,TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_installment_agreement(UUID,TEXT,TEXT,UUID,DECIMAL,DECIMAL,INTEGER,plan_frequency,UUID,TEXT,DATE,UUID,TEXT)
  TO service_role;

-- ============================================================================
-- THE DASHBOARD
-- ============================================================================

CREATE OR REPLACE FUNCTION get_installment_overview()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'requests_pending',  (SELECT count(*) FROM installment_requests WHERE status='pending'),
    'agreements_active', (SELECT count(*) FROM purchases WHERE status IN ('pending','active')),
    'agreements_done',   (SELECT count(*) FROM purchases WHERE status='fully_paid'),
    'customers',         (SELECT count(DISTINCT member_id) FROM purchases),
    'expected',          (SELECT COALESCE(sum(total_payable),0) FROM purchases
                           WHERE status NOT IN ('cancelled','refunded')),
    'collected',         (SELECT COALESCE(sum(amount),0) FROM payment_allocations
                           WHERE purchase_id IS NOT NULL AND reversed_at IS NULL),
    'outstanding',       (SELECT COALESCE(sum(i.amount - i.amount_paid),0)
                           FROM purchase_installments i JOIN purchases p ON p.id=i.purchase_id
                          WHERE i.status <> 'waived' AND p.status NOT IN ('cancelled','refunded')),
    'overdue_count',     (SELECT count(DISTINCT i.purchase_id) FROM purchase_installments i
                          WHERE i.status='overdue'),
    'overdue_amount',    (SELECT COALESCE(sum(i.amount - i.amount_paid),0)
                           FROM purchase_installments i WHERE i.status='overdue'),
    'awaiting_fulfilment',(SELECT count(*) FROM purchases WHERE fulfilment_status='ready'),
    'due_next_7_days',   (SELECT COALESCE(sum(i.amount - i.amount_paid),0)
                           FROM purchase_installments i JOIN purchases p ON p.id=i.purchase_id
                          WHERE i.status='pending' AND p.status NOT IN ('cancelled','refunded')
                            AND i.due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7),
    'orders_awaiting',   (SELECT count(*) FROM orders WHERE status IN ('paid','processing')),
    'orders_revenue',    (SELECT COALESCE(sum(total),0) FROM orders
                           WHERE status NOT IN ('pending_payment','cancelled','refunded'))
  );
$$;

REVOKE ALL ON FUNCTION get_installment_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_installment_overview() TO service_role;

-- ── The request queue ───────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_installment_requests(p_status TEXT DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', r.id, 'reference', r.reference, 'status', r.status,
    'full_name', r.full_name, 'phone', r.phone, 'whatsapp', r.whatsapp,
    'email', r.email, 'address', r.address,
    'product_id', r.product_id, 'plan_id', r.plan_id,
    'product', r.product_name, 'plan', r.plan_name, 'quantity', r.quantity,
    'cash_price', r.cash_price, 'total_payable', r.total_payable,
    'deposit_amount', r.deposit_amount, 'duration_count', r.duration_count,
    'frequency', r.frequency, 'note', r.note, 'admin_note', r.admin_note,
    'purchase_id', r.purchase_id, 'created_at', r.created_at
  ) ORDER BY r.created_at DESC), '[]'::jsonb)
  FROM installment_requests r
  WHERE p_status IS NULL OR r.status::text = p_status;
$$;

REVOKE ALL ON FUNCTION get_installment_requests(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_installment_requests(TEXT) TO service_role;
