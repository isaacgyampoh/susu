-- ============================================================
-- V9 — MULTI-GROUP JOINING + EXISTING-MEMBER ONBOARDING
-- ============================================================

-- A KYC applicant may now select more than one group. The old
-- selected_group_id column is kept (first choice) so nothing that
-- reads it breaks; the full selection lives in the array.
ALTER TABLE kyc_applications
  ADD COLUMN IF NOT EXISTS selected_group_ids UUID[];

UPDATE kyc_applications
SET selected_group_ids = ARRAY[selected_group_id]
WHERE selected_group_ids IS NULL AND selected_group_id IS NOT NULL;

-- Memberships created by onboarding existing (pre-system) members are
-- marked so reports can tell backfilled history from live collections.
ALTER TABLE group_memberships
  ADD COLUMN IF NOT EXISTS onboarded_existing BOOLEAN DEFAULT false;

ALTER TABLE contributions
  ADD COLUMN IF NOT EXISTS is_backfilled BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_contributions_backfilled
  ON contributions(is_backfilled) WHERE is_backfilled;
