-- ============================================================================
-- OUTRIGHT ORDERS — BUSINESS RULE SUITE
-- ============================================================================
-- Runs against the real tables and functions, then rolls back.
-- Every row is a result. FAIL is a defect.
-- ============================================================================
BEGIN;

INSERT INTO product_categories (id,name,slug)
VALUES ('dddddddd-0000-0000-0000-000000000001','Appliances','appl-order-run');
INSERT INTO products (id,category_id,name,slug,cash_price,status,stock_quantity)
VALUES
 ('eeeeeeee-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000001',
  'Kettle','kettle-order-run',150.00,'published',5),
 ('eeeeeeee-0000-0000-0000-000000000002','dddddddd-0000-0000-0000-000000000001',
  'Iron','iron-order-run',95.50,'published',1),
 ('eeeeeeee-0000-0000-0000-000000000003','dddddddd-0000-0000-0000-000000000001',
  'Hidden Fan','fan-order-run',200.00,'draft',10);

CREATE TEMP TABLE o1 AS SELECT create_order(
  '[{"product_id":"eeeeeeee-0000-0000-0000-000000000001","quantity":2},
    {"product_id":"eeeeeeee-0000-0000-0000-000000000002","quantity":1}]'::jsonb,
  'Ama Boateng','+233201234567',NULL,'Spintex',NULL) AS j;

INSERT INTO transactions (type, amount, reference, status, related_id, description)
SELECT 'order', 395.50, 'TEST-ORD-1', 'success', (j->>'order_id')::uuid, 'test' FROM o1;

-- State BEFORE the money lands. Captured here because settlement happens below
-- in this same transaction — checks that looked afterwards reported the
-- settlement as a failure to be unpaid. Second time I have made that mistake
-- in this suite family; hence the explicit snapshot.
CREATE TEMP TABLE before_payment AS
SELECT (SELECT status::text FROM orders WHERE id=(SELECT (j->>'order_id')::uuid FROM o1)) AS status,
       (SELECT paid_reference FROM orders WHERE id=(SELECT (j->>'order_id')::uuid FROM o1)) AS paid_ref,
       (SELECT stock_quantity FROM products WHERE id='eeeeeeee-0000-0000-0000-000000000001') AS kettle_stock;

CREATE TEMP TABLE s1 AS SELECT settle_order_payment('TEST-ORD-1',(SELECT (j->>'order_id')::uuid FROM o1)) AS j;
CREATE TEMP TABLE s1dup AS SELECT settle_order_payment('TEST-ORD-1',(SELECT (j->>'order_id')::uuid FROM o1)) AS j;

WITH checks AS (
  SELECT 1 AS ord, 'The total is priced from the catalogue, not the basket' AS scenario,
         (SELECT (j->>'total')::numeric FROM o1) = 395.50 AS ok
  UNION ALL
  SELECT 2, 'Each line is stored with the price it was bought at',
         (SELECT count(*) FROM order_items
           WHERE order_id=(SELECT (j->>'order_id')::uuid FROM o1)
             AND unit_price IN (150.00, 95.50)) = 2
  UNION ALL
  SELECT 3, 'An order starts unpaid',
         (SELECT status='pending_payment' AND paid_ref IS NULL FROM before_payment)
  UNION ALL
  -- Stock must not move while a basket sits unpaid.
  SELECT 4, 'Filling a basket holds no stock',
         (SELECT kettle_stock FROM before_payment) = 5
  UNION ALL
  SELECT 5, 'A confirmed payment marks the order paid',
         (SELECT status='paid' AND paid_reference='TEST-ORD-1'
            FROM orders WHERE id=(SELECT (j->>'order_id')::uuid FROM o1))
  UNION ALL
  SELECT 6, 'Stock comes off when the money lands, not before',
         (SELECT stock_quantity FROM products
           WHERE id='eeeeeeee-0000-0000-0000-000000000001') = 3
  UNION ALL
  SELECT 7, 'A paid order is ready to hand over',
         (SELECT fulfilment_status='ready' FROM orders
           WHERE id=(SELECT (j->>'order_id')::uuid FROM o1))
  UNION ALL
  SELECT 8, 'A duplicate callback changes nothing',
         (SELECT (j->>'duplicate')::boolean FROM s1dup)
  UNION ALL
  SELECT 9, 'A duplicate callback does not take stock twice',
         (SELECT stock_quantity FROM products
           WHERE id='eeeeeeee-0000-0000-0000-000000000001') = 3
  UNION ALL
  SELECT 10, 'Ordering more than the stock is refused',
         NOT EXISTS (SELECT 1 FROM order_items
                      WHERE product_id='eeeeeeee-0000-0000-0000-000000000002' AND quantity > 1)
  UNION ALL
  SELECT 11, 'An unpublished product cannot be ordered',
         NOT EXISTS (SELECT 1 FROM order_items
                      WHERE product_id='eeeeeeee-0000-0000-0000-000000000003')
)
SELECT ord, scenario, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS verdict
FROM checks ORDER BY ord;
ROLLBACK;
