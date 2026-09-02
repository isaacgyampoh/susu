-- ============================================================
-- V25 — CLOSE THE RPC DOOR  (Phase 00, containment)
-- ============================================================
-- Every table in this database has RLS enabled and NO policies, which denies
-- anon and authenticated all direct table access. That is the whole security
-- model: nothing reaches the data except an Edge Function holding the service
-- role key, and those functions do their own authorization.
--
-- The model has never actually held.
--
-- PostgreSQL grants EXECUTE on a new function to PUBLIC by default. anon and
-- authenticated are members of PUBLIC. PostgREST exposes every function in the
-- `public` schema as an RPC endpoint. And every one of ours is SECURITY
-- DEFINER, so it runs as the owner and bypasses the RLS that is supposed to be
-- protecting the tables.
--
-- No migration in this project has ever issued a GRANT or a REVOKE. So with the
-- anon key that ships inside the browser bundle, unauthenticated, anyone can
-- POST to /rest/v1/rpc/<name> and:
--
--   verify_member_passcode   brute-force a 6-digit PIN with no rate limit,
--                            because check_login_allowed lives in the Edge
--                            Function and is not in this path. Account
--                            takeover for every member.
--   verify_admin_password    the same against the admin password.
--   record_partial_payment   mark any contribution paid. For free.
--   activate_group           rebuild any group's schedule, delete its pending
--                            contributions, move every member's payout date.
--   forfeit_membership       forfeit any slot and suspend the account.
--   get_member_statement     read any member's entire ledger.
--   get_platform_analytics   read the whole platform's finances.
--   revoke_member_sessions   lock any member out at will.
--
-- This migration takes EXECUTE away from PUBLIC, anon and authenticated on
-- every non-trigger function in `public`, and grants it back only to
-- service_role — the role the Edge Functions actually use.
--
-- WHAT THIS DOES NOT BREAK
--   * Edge Functions. They authenticate as service_role, granted below.
--   * Triggers. Trigger functions are excluded, and PostgreSQL checks EXECUTE
--     on a trigger function when the trigger is CREATED, not when it fires.
--   * Extension functions (pgcrypto's crypt/gen_salt, uuid-ossp). Excluded by
--     their extension dependency — revoking those would break password
--     hashing itself.
--
-- Re-runnable and non-destructive: it changes privileges only. No data, no
-- schema, no function bodies are touched.
-- ============================================================

BEGIN;

-- ── 1. Revoke EXECUTE from the internet-facing roles ──────────────────────
DO $$
DECLARE
  r         RECORD;
  n_revoked INT := 0;
  role_name TEXT;
  -- The two roles PostgREST switches into for an unauthenticated and an
  -- end-user request. Guarded by a pg_roles check below so this migration is
  -- also safe on a plain Postgres or a restored dump where they may not exist.
  api_roles TEXT[] := ARRAY['anon', 'authenticated'];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      -- Normal functions only. Procedures and aggregates are not RPC-callable
      -- here, and trigger functions must keep working when triggers fire.
      AND p.prokind = 'f'
      AND p.prorettype <> 'pg_catalog.trigger'::regtype
      -- Never touch anything owned by an extension: pgcrypto's crypt() and
      -- gen_salt() are called by our own SECURITY DEFINER functions, and
      -- revoking them would break every passcode check in the system.
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid
          AND d.classid = 'pg_proc'::regclass
          AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);

    FOREACH role_name IN ARRAY api_roles LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', r.sig, role_name);
      END IF;
    END LOOP;

    -- The Edge Functions are the only legitimate caller. Granting this back is
    -- what keeps the platform working after the revoke above.
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
    END IF;

    n_revoked := n_revoked + 1;
  END LOOP;

  RAISE NOTICE 'v25: locked down % function(s) in schema public', n_revoked;
END;
$$;

-- ── 2. Stop the hole reopening on the next CREATE FUNCTION ────────────────
-- Default privileges apply to functions created later by the same role, so a
-- future migration cannot silently re-expose an RPC by simply defining it.
-- Applies to functions created later by the role running this migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    -- Via EXECUTE: ALTER DEFAULT PRIVILEGES is a utility statement, and
    -- routing it through SPI explicitly avoids any question of whether
    -- PL/pgSQL will accept it inline.
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role';
  END IF;
END;
$$;

-- ── 3. Do not let anon discover the surface either ────────────────────────
-- USAGE on the schema is required to reference an object in it. Revoking it
-- from anon/authenticated is defence in depth behind the EXECUTE revoke: even
-- a function accidentally granted later stays unreachable by name.
--
-- NOTE: this is deliberately NOT applied. Supabase's PostgREST needs schema
-- USAGE for anon to reach the tables it is allowed to reach, and the
-- public_read_groups RLS policy on susu_groups depends on exactly that. The
-- EXECUTE revoke above is the control that matters; taking USAGE as well
-- would break the public group listing on the marketing site.
--
--   REVOKE USAGE ON SCHEMA public FROM anon, authenticated;   -- do not enable

COMMIT;

-- ============================================================
-- VERIFICATION — run this after applying. Every row it returns is a
-- function still reachable by an unauthenticated caller. It must return
-- ZERO rows.
-- ============================================================
--
--   SELECT p.oid::regprocedure AS still_exposed,
--          grantee
--   FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   CROSS JOIN LATERAL (VALUES ('anon'), ('authenticated'), ('public')) AS g(grantee)
--   WHERE n.nspname = 'public'
--     AND p.prokind = 'f'
--     AND p.prorettype <> 'pg_catalog.trigger'::regtype
--     AND NOT EXISTS (
--       SELECT 1 FROM pg_depend d
--       WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass AND d.deptype = 'e')
--     AND has_function_privilege(g.grantee, p.oid, 'EXECUTE');
--
-- And confirm the Edge Functions can still work — this must return every
-- function the functions call (19 of them at the time of writing):
--
--   SELECT p.oid::regprocedure
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.prokind = 'f'
--     AND p.prorettype <> 'pg_catalog.trigger'::regtype
--     AND has_function_privilege('service_role', p.oid, 'EXECUTE');
