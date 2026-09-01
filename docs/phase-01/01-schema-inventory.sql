-- ============================================================================
-- PHASE 01 · QUERY 1 of 3 — PRODUCTION SCHEMA INVENTORY
-- ============================================================================
-- Paste this whole file into the Supabase SQL Editor and run it.
--
-- It returns ONE row with ONE column of JSON. Click the cell, copy the value,
-- and send it back. Nothing here writes, locks, or reads member data — it
-- reads catalog tables only, so it is safe to run on production at any time.
--
-- What it captures, so the repository can be diffed against reality:
--   extensions · enums · tables · columns · constraints · indexes · triggers
--   functions (with a body hash for drift detection) · FUNCTION PRIVILEGES
--   RLS status · RLS policies · table grants · sequences · views
--
-- The function-privileges section is the one that matters most right now: it
-- answers whether F-03 (every SECURITY DEFINER function callable with the
-- public anon key) is still open, and whether the v25 migration has been
-- applied yet.
-- ============================================================================

SELECT jsonb_pretty(jsonb_build_object(

  'captured_at', now(),
  'database',    current_database(),
  'pg_version',  version(),

  -- ── Extensions ──────────────────────────────────────────────────────────
  'extensions', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', e.extname, 'version', e.extversion, 'schema', n.nspname
    ) ORDER BY e.extname), '[]'::jsonb)
    FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
  ),

  -- ── Enum types and their values ─────────────────────────────────────────
  'enums', (
    SELECT COALESCE(jsonb_object_agg(t.typname, vals), '{}'::jsonb)
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN LATERAL (
      SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) AS vals
      FROM pg_enum e WHERE e.enumtypid = t.oid
    ) v ON true
    WHERE n.nspname = 'public' AND t.typtype = 'e'
  ),

  -- ── Tables, columns, types, defaults, generated columns ─────────────────
  'tables', (
    SELECT COALESCE(jsonb_object_agg(tablename, cols), '{}'::jsonb)
    FROM (
      SELECT c.relname AS tablename,
             jsonb_agg(jsonb_build_object(
               'column',     a.attname,
               'type',       format_type(a.atttypid, a.atttypmod),
               'not_null',   a.attnotnull,
               'default',    pg_get_expr(ad.adbin, ad.adrelid),
               'identity',   NULLIF(a.attidentity, ''),
               'generated',  NULLIF(a.attgenerated, ''),
               'position',   a.attnum
             ) ORDER BY a.attnum) AS cols
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
      WHERE n.nspname = 'public' AND c.relkind = 'r'
      GROUP BY c.relname
    ) t
  ),

  -- ── Constraints: PK, FK, UNIQUE, CHECK ──────────────────────────────────
  'constraints', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'table',      rel.relname,
      'name',       con.conname,
      'type',       CASE con.contype
                      WHEN 'p' THEN 'PRIMARY KEY' WHEN 'f' THEN 'FOREIGN KEY'
                      WHEN 'u' THEN 'UNIQUE'      WHEN 'c' THEN 'CHECK'
                      WHEN 'x' THEN 'EXCLUDE'     ELSE con.contype::text END,
      'definition', pg_get_constraintdef(con.oid)
    ) ORDER BY rel.relname, con.contype, con.conname), '[]'::jsonb)
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = rel.relnamespace
    WHERE n.nspname = 'public'
  ),

  -- ── Indexes (definition + uniqueness + partial predicate) ───────────────
  -- This is where uniq_contribution_ref will show up, or fail to.
  'indexes', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'table',      tablename,
      'name',       indexname,
      'definition', indexdef,
      'is_unique',  indexdef LIKE 'CREATE UNIQUE%',
      'is_partial', indexdef LIKE '% WHERE %'
    ) ORDER BY tablename, indexname), '[]'::jsonb)
    FROM pg_indexes WHERE schemaname = 'public'
  ),

  -- ── Triggers ────────────────────────────────────────────────────────────
  'triggers', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'table',      c.relname,
      'name',       t.tgname,
      'definition', pg_get_triggerdef(t.oid),
      'enabled',    t.tgenabled
    ) ORDER BY c.relname, t.tgname), '[]'::jsonb)
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
  ),

  -- ── Functions: signature, security, owner, and a body hash ──────────────
  -- body_md5 lets us diff the DEPLOYED definition against the repository
  -- without dumping thousands of lines. Where a hash disagrees with what the
  -- migration files predict, that function has drifted.
  'functions', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'signature',    p.oid::regprocedure::text,
      'name',         p.proname,
      'returns',      pg_get_function_result(p.oid),
      'kind',         CASE p.prokind WHEN 'f' THEN 'function' WHEN 'p' THEN 'procedure'
                                     WHEN 'a' THEN 'aggregate' ELSE p.prokind::text END,
      'security_definer', p.prosecdef,
      'volatility',   CASE p.provolatile WHEN 'i' THEN 'immutable'
                                         WHEN 's' THEN 'stable' ELSE 'volatile' END,
      'owner',        pg_get_userbyid(p.proowner),
      'language',     l.lanname,
      'search_path',  (SELECT s FROM unnest(COALESCE(p.proconfig, '{}'::text[])) s WHERE s LIKE 'search_path=%'),
      'body_md5',     md5(COALESCE(p.prosrc, '')),
      'body_lines',   array_length(string_to_array(COALESCE(p.prosrc, ''), E'\n'), 1),
      'from_extension', EXISTS (
        SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass AND d.deptype = 'e')
    ) ORDER BY p.proname, p.oid::regprocedure::text), '[]'::jsonb)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public'
  ),

  -- ── FUNCTION PRIVILEGES — the F-03 answer ───────────────────────────────
  -- Any function where anon or authenticated has EXECUTE is callable by
  -- anyone holding the public anon key. After v25 this must be empty.
  'function_privileges', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'signature', sig, 'grantee', grantee, 'has_execute', true
    ) ORDER BY sig, grantee), '[]'::jsonb)
    FROM (
      SELECT p.oid::regprocedure::text AS sig, g.grantee
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN LATERAL (VALUES ('anon'), ('authenticated'), ('public'), ('service_role')) AS g(grantee)
      WHERE n.nspname = 'public'
        AND p.prokind = 'f'
        AND p.prorettype <> 'pg_catalog.trigger'::regtype
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d
          WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass AND d.deptype = 'e')
        AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = g.grantee OR g.grantee = 'public')
        AND has_function_privilege(g.grantee, p.oid, 'EXECUTE')
    ) x
  ),

  -- ── RLS status per table ────────────────────────────────────────────────
  'rls_status', (
    SELECT COALESCE(jsonb_object_agg(c.relname, jsonb_build_object(
      'rls_enabled', c.relrowsecurity,
      'rls_forced',  c.relforcerowsecurity,
      'policy_count', (SELECT count(*) FROM pg_policy pol WHERE pol.polrelid = c.oid)
    )), '{}'::jsonb)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
  ),

  -- ── RLS policies in full ────────────────────────────────────────────────
  'rls_policies', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'table', tablename, 'name', policyname, 'permissive', permissive,
      'roles', roles, 'command', cmd, 'using', qual, 'with_check', with_check
    ) ORDER BY tablename, policyname), '[]'::jsonb)
    FROM pg_policies WHERE schemaname = 'public'
  ),

  -- ── Table-level grants to the API roles ─────────────────────────────────
  -- RLS only bites if the role also has the table privilege. Both matter.
  'table_grants', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'table', table_name, 'grantee', grantee, 'privilege', privilege_type
    ) ORDER BY table_name, grantee, privilege_type), '[]'::jsonb)
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
  ),

  -- ── Sequences ───────────────────────────────────────────────────────────
  'sequences', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', c.relname, 'last_value', s.last_value, 'increment', s.increment_by
    ) ORDER BY c.relname), '[]'::jsonb)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN LATERAL (SELECT * FROM pg_sequences q
                  WHERE q.schemaname = n.nspname AND q.sequencename = c.relname) s ON true
    WHERE n.nspname = 'public' AND c.relkind = 'S'
  ),

  -- ── Views and materialised views ────────────────────────────────────────
  'views', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', c.relname,
      'kind', CASE c.relkind WHEN 'v' THEN 'view' ELSE 'materialized view' END,
      'definition', pg_get_viewdef(c.oid, true)
    ) ORDER BY c.relname), '[]'::jsonb)
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
  ),

  -- ── Roles present ───────────────────────────────────────────────────────
  'roles', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'name', rolname, 'superuser', rolsuper, 'can_login', rolcanlogin,
      'bypass_rls', rolbypassrls
    ) ORDER BY rolname), '[]'::jsonb)
    FROM pg_roles
    WHERE rolname NOT LIKE 'pg\_%'
  ),

  -- Scheduled jobs are captured by the separate query at the foot of this
  -- file. They cannot go here: PostgreSQL parses every branch of a CASE, so a
  -- reference to cron.job would raise "schema cron does not exist" at parse
  -- time even inside a branch guarded to never execute.
  'cron_jobs', '"see separate query below"'::jsonb

)) AS production_schema_inventory;


-- ============================================================================
-- OPTIONAL — scheduled jobs. Run separately. If pg_cron is not installed this
-- errors, and that answer is itself useful: it would mean the 10-minute
-- settlement sweeper is not running, and payments are settling only when a
-- member happens to keep the app open.
-- ============================================================================
--
--   SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobname;
--
-- ============================================================================
