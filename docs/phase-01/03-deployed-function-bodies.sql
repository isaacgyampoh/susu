-- ============================================================================
-- PHASE 01 · QUERY 3 of 3 — DEPLOYED FUNCTION DEFINITIONS
-- ============================================================================
-- Read-only. Returns the ACTUAL source of the business-critical functions as
-- they exist in production, so they can be diffed line-by-line against the
-- migration files.
--
-- This is the migration-drift detector. The repository cannot be trusted on
-- its own here: `supabase/scripts/apply-pending-migrations.sql` begins at V9,
-- which means V1–V8 were applied by some other route and we do not know which
-- version of `activate_group` actually won.
--
-- That matters concretely. V8 made activation REFUSE when cashout_amount is
-- unset ("a payout must never be a number the system made up"). V11, V12 and
-- V15 each silently restored the formula fallback V8 removed. Whichever body
-- comes back below is the one deciding what members are paid.
--
-- Returns one row per function. Copy the whole result grid.
-- ============================================================================

SELECT
  p.oid::regprocedure::text                        AS signature,
  p.prosecdef                                      AS security_definer,
  pg_get_userbyid(p.proowner)                      AS owner,
  md5(p.prosrc)                                    AS body_md5,
  array_length(string_to_array(p.prosrc, E'\n'),1) AS body_lines,
  -- The full deployed source, ready to diff against the migration files
  pg_get_functiondef(p.oid)                        AS deployed_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    -- Schedule and payout arithmetic — the F-12 question lives here
    'activate_group',
    'generate_membership_schedule',
    'check_payout_eligibility',
    'forfeit_membership',
    -- Balance calculation — the F-01 question (two competing implementations)
    'get_membership_balance',
    'get_member_plan_balance',
    -- Settlement
    'record_partial_payment',
    'flag_late_contributions',
    'mark_overdue_contributions',
    -- Auth surface
    'verify_member_passcode',
    'verify_admin_password',
    'session_is_current',
    'change_admin_password',
    'check_login_allowed',
    'record_login_attempt',
    'hash_passcode',
    'revoke_member_sessions',
    'revoke_admin_sessions',
    -- Reporting
    'get_group_financials',
    'get_platform_analytics',
    'get_collection_trend',
    'get_member_statement'
  )
ORDER BY p.proname, p.oid::regprocedure::text;


-- ============================================================================
-- SUPPLEMENTARY — run separately if the grid above is awkward to copy.
-- A compact drift summary: which functions exist, in how many overloads.
-- ============================================================================
--
--   SELECT p.proname,
--          count(*)                                   AS overloads,
--          array_agg(p.oid::regprocedure::text)        AS signatures,
--          bool_or(p.prosecdef)                        AS any_security_definer,
--          array_agg(md5(p.prosrc))                    AS body_hashes
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.prokind = 'f'
--     AND p.prorettype <> 'pg_catalog.trigger'::regtype
--     AND NOT EXISTS (SELECT 1 FROM pg_depend d
--                     WHERE d.objid = p.oid AND d.classid='pg_proc'::regclass AND d.deptype='e')
--   GROUP BY p.proname
--   ORDER BY p.proname;
--
-- More than one overload of activate_group is itself a finding: the migrations
-- DROP old signatures before recreating precisely because two candidates make
-- a two-argument call ambiguous, and Postgres raises "function is not unique"
-- at runtime — when an admin clicks Activate, not at deploy time.
-- ============================================================================
