-- ============================================================
-- V19 — WEBSITE VISIBILITY TOGGLE + DELETABLE GROUPS
-- ============================================================

-- The admin decides which groups the website shows, independent of
-- status: an active group can keep recruiting, a full one can be hidden.
ALTER TABLE susu_groups
  ADD COLUMN IF NOT EXISTS show_on_website BOOLEAN NOT NULL DEFAULT true;

-- Applications must not chain a group to existence forever. The first
-- choice becomes nullable so deleting a (money-less) group can detach
-- old applications instead of being blocked by them; the application
-- record itself survives.
ALTER TABLE kyc_applications
  ALTER COLUMN selected_group_id DROP NOT NULL;
