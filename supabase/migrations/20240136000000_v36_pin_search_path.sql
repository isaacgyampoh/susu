-- ============================================================================
-- V36 — PIN search_path ON EVERY SECURITY DEFINER FUNCTION  (Phase 06)
-- ============================================================================
-- A SECURITY DEFINER function runs as its owner. Without a pinned search_path
-- it resolves unqualified names using the CALLER's search_path, so anyone able
-- to create an object in an earlier schema can substitute their own table or
-- function and have it run with the owner's privileges.
--
-- The functions added in Phases 03–06 pin it. The 22 legacy ones (v1–v24) do
-- not. v25 already narrowed the exposure considerably by revoking EXECUTE from
-- anon and authenticated — an attacker would additionally need schema-create
-- rights — but this is defence in depth and costs nothing.
--
-- ── THE PATH MATTERS ─────────────────────────────────────────────────────
-- Verified before writing this, not assumed:
--
--     pgcrypto   → extensions
--     uuid-ossp  → extensions
--
-- So the correct path is `public, extensions, pg_temp`. Pinning these to
-- `public, pg_temp` — the obvious choice — would break crypt(), gen_salt() and
-- uuid_generate_v4(), and therefore every passcode check and every member
-- insert in the platform.
--
-- `pg_temp` goes LAST deliberately: a temporary object must never shadow a real
-- one during resolution.
--
-- Privileges-only. No function body is changed.
-- ============================================================================

BEGIN;

DO $$
DECLARE r RECORD; n INT := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
    WHERE nsp.nspname = 'public'
      AND p.prosecdef
      AND NOT EXISTS (
        SELECT 1 FROM unnest(COALESCE(p.proconfig,'{}'::text[])) s WHERE s LIKE 'search_path=%')
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions, pg_temp', r.sig);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'v36: pinned search_path on % function(s)', n;
END;
$$;

COMMIT;
