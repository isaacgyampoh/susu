-- ============================================================
-- V14 — PORTAL INVITES ON YOUR SCHEDULE
-- ============================================================
-- Credentials no longer have to go out the moment a member is created.
-- We track when (and whether) each member's portal invite was sent, so
-- everyone can be invited in one batch once the payment system is live.

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS credentials_sent_at TIMESTAMPTZ;
