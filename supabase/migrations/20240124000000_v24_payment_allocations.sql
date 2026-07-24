-- ============================================================
-- V24 — PAYMENT ALLOCATIONS
-- ============================================================
-- One payment can settle several days across several groups. Until now the
-- breakdown existed only for a moment inside the settlement function and was
-- never stored, so neither the admin nor the member could see what a GHS 500
-- payment actually covered. This records each day a payment settled, so the
-- allocation is visible and auditable forever.

CREATE TABLE IF NOT EXISTS payment_allocations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference       TEXT NOT NULL,                       -- the payment reference
  member_id       UUID REFERENCES members(id) ON DELETE CASCADE,
  contribution_id UUID REFERENCES contributions(id) ON DELETE CASCADE,
  membership_id   UUID,                                -- the slot it landed in
  group_id        UUID,
  group_name      TEXT,
  amount          DECIMAL(10,2) NOT NULL,              -- applied to this day
  kind            TEXT NOT NULL DEFAULT 'full',        -- 'full' | 'part'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alloc_reference  ON payment_allocations(reference);
CREATE INDEX IF NOT EXISTS idx_alloc_member     ON payment_allocations(member_id, created_at DESC);

ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;

-- Leftover credit a member carries (overpaid beyond everything they owe).
-- Applied first the next time they pay.
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS credit_balance DECIMAL(10,2) NOT NULL DEFAULT 0;
