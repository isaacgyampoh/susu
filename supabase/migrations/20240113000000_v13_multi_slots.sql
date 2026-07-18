-- ============================================================
-- V13 — A MEMBER CAN HOLD SEVERAL SLOTS IN ONE GROUP
-- ============================================================
-- One person, one group, three slots = three membership rows, each with
-- its own payout position, its own daily schedule, and its own payout.
-- The one-membership-per-group constraint is therefore dropped;
-- UNIQUE(group_id, payout_position) stays — no two slots share a turn.

ALTER TABLE group_memberships
  DROP CONSTRAINT IF EXISTS group_memberships_member_id_group_id_key;

-- Website applicants choose how many slots they want per group:
-- { "<group_id>": <slots>, ... }
ALTER TABLE kyc_applications
  ADD COLUMN IF NOT EXISTS selected_slots JSONB;
