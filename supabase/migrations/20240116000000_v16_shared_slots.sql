-- ============================================================
-- V16 — SHARED PAYOUT TURNS
-- ============================================================
-- Two (or more) fractional slots can share one turn: memberships that
-- carry the same shared_slot_key are partners. They keep their own daily
-- schedules and their own fraction of the cashout, but their payout dates
-- move together — change one, all partners follow.

ALTER TABLE group_memberships
  ADD COLUMN IF NOT EXISTS shared_slot_key UUID;

CREATE INDEX IF NOT EXISTS idx_gm_shared_slot
  ON group_memberships(shared_slot_key) WHERE shared_slot_key IS NOT NULL;
