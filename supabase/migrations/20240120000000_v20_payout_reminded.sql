-- ============================================================
-- V20 — PAYOUT REMINDER STAMP
-- ============================================================
-- Lets the scheduled payout-reminder job avoid texting twice if it runs more
-- than once for the same day.

ALTER TABLE payouts
  ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;
