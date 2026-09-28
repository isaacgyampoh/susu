-- ============================================================================
-- V61 — OUTRIGHT ORDERS, INSTALMENT REQUESTS, AND ADMIN-RECORDED PAYMENTS
-- ============================================================================
-- The model moved. A customer can now BUY a thing outright, or ASK to pay for
-- it gradually — and the second one is a request the collector decides on, not
-- something the website grants. Instalment customers get no portal at all:
-- they pay the shop in cash or MoMo, and the collector records it.
--
-- ── WHAT THIS DOES NOT REBUILD ──────────────────────────────────────────────
--
-- `purchases`, `purchase_installments` and `purchase_fulfilments` already are
-- the instalment agreement, snapshot and all. What changes is who creates one:
-- the collector, after approving a request or after somebody walks into the
-- shop. The tables do not care which, so they stand as they are.
--
-- The susu is untouched. 93 members and 213 active slots keep running; joining
-- a rotation simply stops being something the website does.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE request_status AS ENUM
    ('pending','approved','declined','cancelled','converted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE order_status AS ENUM
    ('pending_payment','paid','processing','ready','completed','cancelled','refunded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TYPE tx_type ADD VALUE IF NOT EXISTS 'order';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- INSTALMENT REQUESTS
-- ============================================================================
-- What the website collects. Deliberately NOT a purchase: nothing is owed, no
-- schedule exists, and no stock is held. A purchase is what the collector
-- creates once she has agreed terms with this person — which is the actual
-- business process, and modelling the request as a half-made purchase would
-- put unapproved obligations into the same table as real ones.
--
-- No `member_id`. Somebody asking about a fridge is not a member yet and may
-- never be one; requiring an account here would put a sign-up between the
-- customer and the enquiry.
-- ============================================================================

CREATE TABLE IF NOT EXISTS installment_requests (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference     TEXT NOT NULL UNIQUE,            -- REQ-XXXXXXXX
  status        request_status NOT NULL DEFAULT 'pending',

  -- Who is asking. Phone is the identity, as everywhere else here.
  full_name     TEXT NOT NULL,
  phone         TEXT NOT NULL,
  whatsapp      TEXT,
  email         TEXT,
  address       TEXT,

  -- What they want, snapshotted: the catalogue may be edited between the
  -- request arriving and the collector reading it, and she needs to see what
  -- the customer was actually shown.
  product_id        UUID REFERENCES products(id) ON DELETE SET NULL,
  plan_id           UUID REFERENCES payment_plans(id) ON DELETE SET NULL,
  product_name      TEXT NOT NULL,
  plan_name         TEXT,
  quantity          INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  cash_price        DECIMAL(10,2) NOT NULL CHECK (cash_price >= 0),
  total_payable     DECIMAL(10,2),
  deposit_amount    DECIMAL(10,2) NOT NULL DEFAULT 0,
  duration_count    INTEGER,
  frequency         plan_frequency,

  note          TEXT,                            -- the customer's own words
  admin_note    TEXT,
  decided_by    UUID REFERENCES admin_users(id),
  decided_at    TIMESTAMPTZ,
  -- Set when the collector turns this into a real agreement.
  purchase_id   UUID REFERENCES purchases(id) ON DELETE SET NULL,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_requests_pending ON installment_requests(created_at DESC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_requests_phone ON installment_requests(phone);

-- ============================================================================
-- OUTRIGHT ORDERS
-- ============================================================================
-- Paid in full through the provider, like any shop. Separate from `purchases`
-- because they are a different obligation: an order is settled at the moment
-- it is paid and has no schedule, no balance and nothing to chase.
-- ============================================================================

CREATE TABLE IF NOT EXISTS orders (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference     TEXT NOT NULL UNIQUE,            -- AW-1024
  status        order_status NOT NULL DEFAULT 'pending_payment',

  full_name     TEXT NOT NULL,
  phone         TEXT NOT NULL,
  email         TEXT,
  address       TEXT,
  delivery_note TEXT,

  -- Totals are stored, not recomputed from lines at read time: a price edit
  -- would otherwise silently restate what somebody already paid.
  subtotal      DECIMAL(10,2) NOT NULL CHECK (subtotal >= 0),
  delivery_fee  DECIMAL(10,2) NOT NULL DEFAULT 0,
  total         DECIMAL(10,2) NOT NULL CHECK (total >= 0),

  -- The payment that settled it. NULL until the provider confirms.
  paid_reference TEXT,
  paid_at        TIMESTAMPTZ,

  fulfilment_status fulfilment_status NOT NULL DEFAULT 'not_ready',
  admin_note     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_phone  ON orders(phone);

CREATE TABLE IF NOT EXISTS order_items (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_id    UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  UUID REFERENCES products(id) ON DELETE SET NULL,
  -- Snapshotted for the same reason as everything else here.
  product_name TEXT NOT NULL,
  unit_price   DECIMAL(10,2) NOT NULL CHECK (unit_price >= 0),
  quantity     INTEGER NOT NULL CHECK (quantity > 0),
  line_total   DECIMAL(10,2) NOT NULL CHECK (line_total >= 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_order_items ON order_items(order_id);

-- ============================================================================
-- HOW A MANUAL PAYMENT IS RECORDED
-- ============================================================================
-- The customer hands over cash, or sends MoMo to the shop's own number. There
-- is no provider callback, because the provider was never involved.
--
-- It still goes through `transactions` and `settle_purchase_payment`. That is
-- the whole point: one allocation ledger, one settlement path, one answer to
-- "how much has this person paid". A separate manual-payments table would be a
-- second answer, and the two would disagree the first time anyone reconciled.
--
-- `reference` carries MANUAL- so the origin is never ambiguous in the ledger,
-- and the method and the collector who took it are recorded beside it.
-- ============================================================================

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS method      TEXT,
  ADD COLUMN IF NOT EXISTS recorded_by UUID REFERENCES admin_users(id),
  ADD COLUMN IF NOT EXISTS paid_on     DATE;

COMMENT ON COLUMN transactions.recorded_by IS
  'Set only for payments an administrator entered by hand (cash, MoMo, bank). '
  'NULL means the payment came from the provider. Never overwritten.';

CREATE OR REPLACE FUNCTION record_manual_payment(
  p_purchase_id UUID,
  p_amount      DECIMAL,
  p_method      TEXT,
  p_admin_id    UUID,
  p_reference   TEXT DEFAULT NULL,
  p_paid_on     DATE DEFAULT CURRENT_DATE,
  p_note        TEXT DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_purchase purchases%ROWTYPE;
  v_ref      TEXT;
  v_balance  DECIMAL(10,2);
  v_result   jsonb;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Enter an amount greater than zero';
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('cash','momo','bank','other') THEN
    RAISE EXCEPTION 'Payment method must be cash, momo, bank or other';
  END IF;

  SELECT * INTO v_purchase FROM purchases WHERE id = p_purchase_id FOR UPDATE;
  IF v_purchase.id IS NULL THEN
    RAISE EXCEPTION 'No such purchase' USING ERRCODE = 'no_data_found';
  END IF;
  IF v_purchase.status IN ('cancelled','refunded') THEN
    RAISE EXCEPTION 'This purchase is % and cannot take payments', v_purchase.status;
  END IF;

  SELECT COALESCE(sum(amount - amount_paid), 0) INTO v_balance
    FROM purchase_installments
   WHERE purchase_id = p_purchase_id AND status <> 'waived';

  IF v_balance <= 0.004 THEN
    RAISE EXCEPTION 'This purchase is already paid in full';
  END IF;
  -- Refused rather than absorbed: money beyond the balance is a conversation
  -- about a refund, not a number to quietly swallow.
  IF p_amount > v_balance + 0.004 THEN
    RAISE EXCEPTION 'That is more than the GHS % still owing', to_char(v_balance,'FM999999990.00');
  END IF;

  v_ref := 'MANUAL-' || upper(substr(replace(gen_random_uuid()::text,'-',''), 1, 10));

  INSERT INTO transactions
    (member_id, type, amount, reference, status, description,
     related_id, method, recorded_by, paid_on)
  VALUES
    (v_purchase.member_id, 'installment', p_amount, v_ref, 'success',
     COALESCE(p_note, 'Payment received at the shop') ||
       CASE WHEN p_reference IS NOT NULL THEN ' · ref ' || p_reference ELSE '' END,
     p_purchase_id, p_method, p_admin_id, p_paid_on);

  -- Same engine as a provider payment. Allocates oldest instalment first,
  -- writes payment_allocations, flips the purchase to fully_paid and ready
  -- when the balance lands on zero.
  v_result := settle_purchase_payment(v_ref, p_purchase_id);

  RETURN v_result || jsonb_build_object('reference', v_ref, 'method', p_method);
END $$;

REVOKE ALL ON FUNCTION record_manual_payment(UUID,DECIMAL,TEXT,UUID,TEXT,DATE,TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION record_manual_payment(UUID,DECIMAL,TEXT,UUID,TEXT,DATE,TEXT)
  TO service_role;

-- ── updated_at, as everywhere else ──────────────────────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['installment_requests','orders'] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I;
       CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION fn_updated_at();', t, t, t, t);
  END LOOP;
END $$;
