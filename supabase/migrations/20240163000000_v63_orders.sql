-- ============================================================================
-- V63 — BUYING OUTRIGHT
-- ============================================================================
-- A cart, a price checked against the catalogue, a payment, an order. Nothing
-- is owed afterwards: an order is settled the moment it is paid and has no
-- schedule and no balance to chase, which is exactly why it is not a purchase.
-- ============================================================================

-- ── PRICES COME FROM THE DATABASE, NEVER THE CART ───────────────────────────
--
-- The browser sends product ids and quantities. It does NOT send prices, and
-- this function would ignore them if it did: the line totals are read from
-- `products` here. A cart is a list of intentions held in somebody's browser,
-- and a browser is not a place prices can be trusted to survive unedited.
--
-- Stock is checked in the same statement that takes it, under the row lock, so
-- two people buying the last fridge cannot both succeed.

CREATE OR REPLACE FUNCTION create_order(
  p_items     jsonb,              -- [{ product_id, quantity }]
  p_full_name TEXT,
  p_phone     TEXT,
  p_email     TEXT DEFAULT NULL,
  p_address   TEXT DEFAULT NULL,
  p_note      TEXT DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_item     jsonb;
  v_product  products%ROWTYPE;
  v_qty      INTEGER;
  v_subtotal DECIMAL(10,2) := 0;
  v_line     DECIMAL(10,2);
  v_order    orders%ROWTYPE;
  v_ref      TEXT;
  v_count    INTEGER := 0;
BEGIN
  IF length(btrim(COALESCE(p_full_name,''))) < 2 THEN
    RAISE EXCEPTION 'Please give your name'; END IF;
  IF p_phone IS NULL OR length(regexp_replace(p_phone,'\D','','g')) < 9 THEN
    RAISE EXCEPTION 'Please give a phone number we can reach you on'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Your basket is empty'; END IF;

  v_ref := 'AW-' || upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 8));

  INSERT INTO orders (reference, full_name, phone, email, address, delivery_note,
                      subtotal, total, status)
  VALUES (v_ref, btrim(p_full_name), p_phone,
          NULLIF(btrim(COALESCE(p_email,'')),''),
          NULLIF(btrim(COALESCE(p_address,'')),''),
          NULLIF(btrim(COALESCE(p_note,'')),''),
          0, 0, 'pending_payment')
  RETURNING * INTO v_order;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := GREATEST(COALESCE((v_item->>'quantity')::int, 1), 1);

    SELECT * INTO v_product FROM products
     WHERE id = (v_item->>'product_id')::uuid FOR UPDATE;

    IF v_product.id IS NULL THEN
      RAISE EXCEPTION 'One of those products no longer exists'; END IF;
    IF v_product.status <> 'published' THEN
      RAISE EXCEPTION '"%" is not on sale', v_product.name; END IF;
    IF v_product.stock_quantity IS NOT NULL AND v_product.stock_quantity < v_qty THEN
      RAISE EXCEPTION 'Only % of "%" left', v_product.stock_quantity, v_product.name; END IF;

    v_line := ROUND(v_product.cash_price * v_qty, 2);
    v_subtotal := v_subtotal + v_line;

    INSERT INTO order_items (order_id, product_id, product_name,
                             unit_price, quantity, line_total)
    VALUES (v_order.id, v_product.id, v_product.name,
            v_product.cash_price, v_qty, v_line);

    v_count := v_count + 1;
  END LOOP;

  UPDATE orders SET subtotal = v_subtotal, total = v_subtotal
   WHERE id = v_order.id;

  RETURN jsonb_build_object(
    'order_id', v_order.id, 'reference', v_ref,
    'subtotal', v_subtotal, 'total', v_subtotal, 'lines', v_count);
END $$;

REVOKE ALL ON FUNCTION create_order(jsonb,TEXT,TEXT,TEXT,TEXT,TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_order(jsonb,TEXT,TEXT,TEXT,TEXT,TEXT) TO service_role;

-- ============================================================================
-- MARKING AN ORDER PAID
-- ============================================================================
-- Called only after the provider has confirmed. Idempotent on the reference,
-- because the phone asking "did it land?" and NaloPay saying so independently
-- are two doors into the same room and either may arrive first.
--
-- Stock comes off HERE, not when the basket is filled: an abandoned checkout
-- must not hold the last fridge hostage.
-- ============================================================================

CREATE OR REPLACE FUNCTION settle_order_payment(
  p_reference TEXT, p_order_id UUID
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tx    transactions%ROWTYPE;
  v_order orders%ROWTYPE;
  v_line  RECORD;
BEGIN
  SELECT * INTO v_tx FROM transactions WHERE reference = p_reference FOR UPDATE;
  IF v_tx.id IS NULL THEN
    RAISE EXCEPTION 'No payment with reference %', p_reference USING ERRCODE='no_data_found';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'No such order' USING ERRCODE='no_data_found'; END IF;

  -- Already settled. Report it; change nothing.
  IF v_order.paid_reference IS NOT NULL THEN
    RETURN jsonb_build_object('duplicate', true, 'reference', v_order.paid_reference,
                              'status', v_order.status);
  END IF;

  IF v_tx.status <> 'success' THEN
    RAISE EXCEPTION 'Payment % is %, not success', p_reference, v_tx.status; END IF;
  IF v_tx.amount + 0.004 < v_order.total THEN
    RAISE EXCEPTION 'That payment is less than the order total';
  END IF;

  UPDATE orders
     SET status = 'paid', paid_reference = p_reference, paid_at = NOW(),
         fulfilment_status = 'ready'
   WHERE id = p_order_id;

  FOR v_line IN
    SELECT product_id, quantity FROM order_items WHERE order_id = p_order_id
  LOOP
    IF v_line.product_id IS NOT NULL THEN
      UPDATE products
         SET stock_quantity = GREATEST(stock_quantity - v_line.quantity, 0)
       WHERE id = v_line.product_id AND stock_quantity IS NOT NULL;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('duplicate', false, 'status', 'paid',
                            'reference', p_reference, 'total', v_order.total);
END $$;

REVOKE ALL ON FUNCTION settle_order_payment(TEXT,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION settle_order_payment(TEXT,UUID) TO service_role;

-- ── The admin's order list ──────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_admin_orders(
  p_status TEXT DEFAULT NULL, p_search TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 50, p_offset INTEGER DEFAULT 0
) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH f AS (
    SELECT o.* FROM orders o
    WHERE (p_status IS NULL OR o.status::text = p_status)
      AND (p_search IS NULL OR p_search = '' OR
           o.full_name ILIKE '%'||p_search||'%' OR o.phone ILIKE '%'||p_search||'%' OR
           o.reference ILIKE '%'||p_search||'%')
  )
  SELECT jsonb_build_object(
    'totals', jsonb_build_object(
      'matching', (SELECT count(*) FROM f),
      'revenue',  (SELECT COALESCE(sum(total),0) FROM f
                    WHERE status NOT IN ('pending_payment','cancelled','refunded')),
      'awaiting', (SELECT count(*) FROM f WHERE status IN ('paid','processing')),
      'unpaid',   (SELECT count(*) FROM f WHERE status = 'pending_payment')),
    'orders', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', o.id, 'reference', o.reference, 'status', o.status,
        'customer', o.full_name, 'phone', o.phone, 'address', o.address,
        'subtotal', o.subtotal, 'total', o.total,
        'paid_at', o.paid_at, 'paid_reference', o.paid_reference,
        'fulfilment_status', o.fulfilment_status,
        'created_at', o.created_at,
        'items', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                     'name', i.product_name, 'qty', i.quantity,
                     'unit_price', i.unit_price, 'line_total', i.line_total)), '[]'::jsonb)
                  FROM order_items i WHERE i.order_id = o.id)
      ) ORDER BY
        -- Paid and not yet handled, first: that is somebody waiting.
        CASE WHEN o.status = 'paid' THEN 0 WHEN o.status = 'processing' THEN 1 ELSE 2 END,
        o.created_at DESC), '[]'::jsonb)
      FROM (SELECT * FROM f
            ORDER BY CASE WHEN status='paid' THEN 0 WHEN status='processing' THEN 1 ELSE 2 END,
                     created_at DESC
            LIMIT p_limit OFFSET p_offset) o)
  );
$$;

REVOKE ALL ON FUNCTION get_admin_orders(TEXT,TEXT,INTEGER,INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_admin_orders(TEXT,TEXT,INTEGER,INTEGER) TO service_role;
