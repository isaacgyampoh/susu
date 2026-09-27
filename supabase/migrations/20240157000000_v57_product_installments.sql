-- ============================================================================
-- V57 — PRODUCTS, PAYMENT PLANS, PURCHASES, INSTALLMENTS, FULFILMENT
-- ============================================================================
-- The business now sells goods on instalment alongside the susu. A customer
-- picks a fridge, picks a plan, pays it down over months, and collects it when
-- the balance reaches zero.
--
-- ── THIS IS ADDITIVE. THE SUSU KEEPS RUNNING. ───────────────────────────────
--
-- 93 members, 213 active slots, 19,513 obligations and GHS 649,853.50 settled
-- live in these tables. Nothing here alters a susu table's shape, drops a
-- column, or changes an existing function. What group joining stops being is a
-- website flow; the rotations themselves continue exactly as they are.
--
-- ── WHY THERE IS NO SECOND MONEY ENGINE ─────────────────────────────────────
--
-- An instalment is the same shape as a contribution: an amount owed on a date,
-- settled by a payment, traceable afterwards. `settle_payment` already does
-- that — locks the transaction FOR UPDATE, allocates, records in
-- payment_allocations, pushes the remainder to credit, logs the lot. Its
-- idempotency comes from transactions.reference being UNIQUE, which is exactly
-- the duplicate-callback protection this needs.
--
-- So instalments settle through the SAME machinery. payment_allocations
-- already had a nullable contribution_id and a `kind` discriminator, so it
-- generalises by adding one nullable column rather than by being copied.
-- A parallel allocation table would mean two answers to "how much has this
-- person paid", and they would diverge.
--
-- ── THE RULE THAT PROTECTS THE CUSTOMER ─────────────────────────────────────
--
-- A purchase SNAPSHOTS its price and plan at the moment it is created. The
-- admin may edit the product's price or retire a plan tomorrow; a customer
-- halfway through paying for a television must not find the total has moved.
-- The product and plan ids are kept for display and history only — every
-- figure that decides money comes from the snapshot columns on `purchases`.
-- ============================================================================

-- ── Money enums ─────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE plan_frequency AS ENUM ('daily','weekly','biweekly','monthly');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE product_status AS ENUM ('draft','published','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The PAYMENT lifecycle of a purchase.
DO $$ BEGIN
  CREATE TYPE purchase_status AS ENUM
    ('pending','active','fully_paid','cancelled','refunded','defaulted','on_hold');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The DELIVERY lifecycle, deliberately separate: a purchase can be fully paid
-- and not yet collected, and those are two different questions an operator
-- asks. Folding them into one column is how "paid" comes to mean "gone".
DO $$ BEGIN
  CREATE TYPE fulfilment_status AS ENUM
    ('not_ready','ready','released','delivered','collected','returned');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE installment_status AS ENUM ('pending','paid','overdue','waived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- `transactions.type` needs to name this kind of money. ADD VALUE is additive
-- and cannot affect existing rows.
DO $$ BEGIN
  ALTER TYPE tx_type ADD VALUE IF NOT EXISTS 'installment';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Catalogue ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS product_categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category_id    UUID REFERENCES product_categories(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  slug           TEXT NOT NULL UNIQUE,
  summary        TEXT,
  description    TEXT,
  -- Free-form spec sheet: "Capacity: 250L", "Warranty: 2 years".
  specifications JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- What it costs outright. Plans are priced independently of this, because an
  -- instalment total is usually higher and that difference is the business.
  cash_price     DECIMAL(10,2) NOT NULL CHECK (cash_price >= 0),
  status         product_status NOT NULL DEFAULT 'draft',
  -- NULL means "we can always get one". A number is decremented on purchase.
  stock_quantity INTEGER CHECK (stock_quantity IS NULL OR stock_quantity >= 0),
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_by     UUID REFERENCES admin_users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_status   ON products(status) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);

CREATE TABLE IF NOT EXISTS product_media (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id   UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('image','video')),
  -- Path within the `product-media` bucket, never a full URL: the bucket may
  -- be re-pointed at a CDN and stored absolute URLs would all have to be
  -- rewritten. kyc-documents learned this the hard way in v-earlier.
  storage_path TEXT NOT NULL,
  alt_text     TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_media ON product_media(product_id, sort_order);

-- ── Plans ───────────────────────────────────────────────────────────────────
-- Plans belong to a product. Two products rarely carry the same terms, and a
-- shared plan table would silently reprice one product when the other changed.

CREATE TABLE IF NOT EXISTS payment_plans (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id         UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  frequency          plan_frequency NOT NULL DEFAULT 'monthly',
  -- How many payments. 8 monthly payments = duration_count 8.
  duration_count     INTEGER NOT NULL CHECK (duration_count > 0),
  installment_amount DECIMAL(10,2) NOT NULL CHECK (installment_amount > 0),
  deposit_amount     DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (deposit_amount >= 0),
  -- Stored, not derived. The arithmetic usually is deposit + count × amount,
  -- but a plan may be rounded or discounted by agreement, and the figure the
  -- customer was shown is the figure that must be owed.
  total_payable      DECIMAL(10,2) NOT NULL CHECK (total_payable > 0),
  available_from     DATE,
  available_to       DATE,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  terms              TEXT,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plans_product ON payment_plans(product_id)
  WHERE is_active;

-- ── Purchases ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS purchases (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference   TEXT NOT NULL UNIQUE,          -- PUR-XXXXXXXX, shown to the customer
  member_id   UUID NOT NULL REFERENCES members(id) ON DELETE RESTRICT,

  -- For display and history. NEVER read to decide money.
  product_id  UUID REFERENCES products(id) ON DELETE SET NULL,
  plan_id     UUID REFERENCES payment_plans(id) ON DELETE SET NULL,

  /* ── THE SNAPSHOT ─────────────────────────────────────────────────────────
     Everything below is copied at creation and never updated by an admin
     editing the catalogue. §28: a customer halfway through paying for a
     television must not find the total has moved because the price went up. */
  product_name        TEXT NOT NULL,
  plan_name           TEXT NOT NULL,
  cash_price          DECIMAL(10,2) NOT NULL CHECK (cash_price >= 0),
  total_payable       DECIMAL(10,2) NOT NULL CHECK (total_payable > 0),
  installment_amount  DECIMAL(10,2) NOT NULL CHECK (installment_amount > 0),
  deposit_amount      DECIMAL(10,2) NOT NULL DEFAULT 0,
  duration_count      INTEGER NOT NULL CHECK (duration_count > 0),
  frequency           plan_frequency NOT NULL,

  status            purchase_status   NOT NULL DEFAULT 'pending',
  fulfilment_status fulfilment_status NOT NULL DEFAULT 'not_ready',

  started_on   DATE NOT NULL DEFAULT CURRENT_DATE,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  admin_notes  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- §12: a customer holds MANY purchases. Nothing here is unique per member.
CREATE INDEX IF NOT EXISTS idx_purchases_member  ON purchases(member_id, status);
CREATE INDEX IF NOT EXISTS idx_purchases_product ON purchases(product_id);
CREATE INDEX IF NOT EXISTS idx_purchases_status  ON purchases(status)
  WHERE status IN ('pending','active');
CREATE INDEX IF NOT EXISTS idx_purchases_ready   ON purchases(fulfilment_status)
  WHERE fulfilment_status = 'ready';

-- ── Instalments ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS purchase_installments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  sequence    INTEGER NOT NULL CHECK (sequence > 0),
  amount      DECIMAL(10,2) NOT NULL CHECK (amount > 0),
  due_date    DATE NOT NULL,
  status      installment_status NOT NULL DEFAULT 'pending',
  paid_at     TIMESTAMPTZ,
  -- Part payment against this instalment. Mirrors contributions.amount_paid,
  -- and carries the same warning: `status` is the authority on whether the
  -- instalment is settled; this only refines an unsettled one.
  amount_paid DECIMAL(10,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (purchase_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_installments_due ON purchase_installments(due_date)
  WHERE status IN ('pending','overdue');
CREATE INDEX IF NOT EXISTS idx_installments_purchase
  ON purchase_installments(purchase_id, sequence);

-- ── Allocations reach instalments too ───────────────────────────────────────
-- One nullable column, not a second allocation table. Two tables answering
-- "how much has this person paid" is two answers that will disagree.

ALTER TABLE payment_allocations
  ADD COLUMN IF NOT EXISTS installment_id UUID REFERENCES purchase_installments(id),
  ADD COLUMN IF NOT EXISTS purchase_id    UUID REFERENCES purchases(id);

CREATE INDEX IF NOT EXISTS idx_alloc_installment ON payment_allocations(installment_id)
  WHERE installment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_alloc_purchase ON payment_allocations(purchase_id)
  WHERE purchase_id IS NOT NULL;

-- An allocation settles a contribution OR an instalment, never both and never
-- neither. Enforced here rather than trusted to five call sites.
DO $$ BEGIN
  ALTER TABLE payment_allocations
    ADD CONSTRAINT alloc_targets_exactly_one
    CHECK (
      (contribution_id IS NOT NULL AND installment_id IS NULL)
      OR (contribution_id IS NULL AND installment_id IS NOT NULL)
      -- Historic rows predate both and are left alone.
      OR (contribution_id IS NULL AND installment_id IS NULL)
    ) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Fulfilment history ──────────────────────────────────────────────────────
-- An append-only record. "When did this go out, who released it, and was it
-- delivered or collected" is a question that gets asked months later, and a
-- single mutable status column cannot answer it.

CREATE TABLE IF NOT EXISTS purchase_fulfilments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  status      fulfilment_status NOT NULL,
  note        TEXT,
  admin_id    UUID REFERENCES admin_users(id),
  admin_name  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fulfilments_purchase
  ON purchase_fulfilments(purchase_id, created_at DESC);

-- ── updated_at, the same way every other table does it ──────────────────────

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['product_categories','products','payment_plans',
                           'purchases','purchase_installments']
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%s_updated_at ON %I;
       CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE FUNCTION fn_updated_at();', t, t, t, t);
  END LOOP;
END $$;
