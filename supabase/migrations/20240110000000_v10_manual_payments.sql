-- ============================================================
-- V10 — MANUAL PAYMENT COLLECTION
-- ============================================================
-- Payments collected by hand (cash in hand, MoMo sent directly,
-- bank transfer) are first-class: we record how each contribution
-- was settled and any reference the admin wants to keep.

ALTER TABLE contributions
  ADD COLUMN IF NOT EXISTS payment_method TEXT,   -- 'cash' | 'momo' | 'bank' | 'paystack' | 'moolre'
  ADD COLUMN IF NOT EXISTS payment_note   TEXT;   -- e.g. MoMo transaction ID, receipt number

CREATE INDEX IF NOT EXISTS idx_contributions_payment_method
  ON contributions(payment_method) WHERE payment_method IS NOT NULL;
