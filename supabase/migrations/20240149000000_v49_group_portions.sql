-- ============================================================================
-- v49 — A GROUP'S PORTIONS BECOME CONFIGURATION, NOT ARITHMETIC
-- ============================================================================
-- WRITES NO EXISTING FINANCIAL ROW. It creates one table, backfills it, and
-- adds one nullable column. No contribution, transaction, allocation or payout
-- is touched.
--
-- ── THE PROBLEM ─────────────────────────────────────────────────────────────
--
-- "Half" was a multiplication, in five places:
--
--     contribution  = susu_groups.contribution_amount * slot_fraction
--     payout        = susu_groups.cashout_amount      * slot_fraction
--     registration  = susu_groups.registration_fee    * slot_fraction
--
-- So a half slot ALWAYS paid exactly half and ALWAYS collected exactly half.
-- That is an assumption about the business, written into the code as though it
-- were a law. A susu can perfectly well run a half portion that pays GHS 500
-- and collects GHS 950 — the whole point of the smaller portions is that they
-- carry their own terms — and there was no way to express it.
--
-- ── WHAT REPLACES IT ────────────────────────────────────────────────────────
--
-- Each group owns a set of portions, and each portion states its own three
-- amounts outright. `fraction` remains, but only to order and label them; it no
-- longer decides any figure.
--
-- ── WHY NOTHING MOVES TODAY ─────────────────────────────────────────────────
--
-- The backfill writes exactly what the multiplication would have produced, for
-- every existing group. Every current member's contribution, payout and fee is
-- therefore identical before and after. The behaviour only diverges where an
-- administrator deliberately changes a number — which is the point.
-- ============================================================================

CREATE TABLE IF NOT EXISTS group_portions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id            uuid NOT NULL REFERENCES susu_groups(id) ON DELETE CASCADE,

  label               text    NOT NULL,
  -- Ordering and display only. It is deliberately NOT used to derive money:
  -- that is the defect this table exists to remove.
  fraction            numeric NOT NULL CHECK (fraction > 0 AND fraction <= 1),

  contribution_amount numeric NOT NULL CHECK (contribution_amount >= 0),
  payout_amount       numeric NOT NULL CHECK (payout_amount >= 0),
  registration_fee    numeric NOT NULL DEFAULT 0 CHECK (registration_fee >= 0),

  is_active           boolean NOT NULL DEFAULT true,
  sort_order          integer NOT NULL DEFAULT 0,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  UNIQUE (group_id, label)
);

CREATE INDEX IF NOT EXISTS idx_group_portions_group ON group_portions(group_id) WHERE is_active;

-- Which portion a membership was taken on. Nullable: memberships that predate
-- this table keep working through the fallback in the schedule generator.
ALTER TABLE group_memberships
  ADD COLUMN IF NOT EXISTS portion_id uuid REFERENCES group_portions(id);

CREATE INDEX IF NOT EXISTS idx_gm_portion ON group_memberships(portion_id) WHERE portion_id IS NOT NULL;


-- ── Backfill: exactly what the multiplication produced ──────────────────────
-- Full, Half and Quarter for every group, at the values the old code computed.
-- ROUND to 2 places to match the JavaScript that wrote these figures.
INSERT INTO group_portions
  (group_id, label, fraction, contribution_amount, payout_amount, registration_fee, sort_order)
SELECT g.id, p.label, p.frac,
       ROUND(COALESCE(g.contribution_amount, 0) * p.frac, 2),
       ROUND(COALESCE(g.cashout_amount, 0)      * p.frac, 2),
       ROUND(COALESCE(g.registration_fee, 0)    * p.frac, 2),
       p.ord
FROM susu_groups g
CROSS JOIN (VALUES ('Full', 1.0, 0), ('Half', 0.5, 1), ('Quarter', 0.25, 2))
  AS p(label, frac, ord)
ON CONFLICT (group_id, label) DO NOTHING;

-- Point existing memberships at the portion matching the fraction they hold.
UPDATE group_memberships gm
SET portion_id = p.id
FROM group_portions p
WHERE p.group_id = gm.group_id
  AND p.fraction = COALESCE(gm.slot_fraction, 1)
  AND gm.portion_id IS NULL;


-- ── The schedule generator reads the portion, and falls back ────────────────
-- A SURGICAL EDIT, not a rewrite. The first draft of this migration replaced
-- the whole function from memory and got four things wrong: it returned void
-- instead of integer, generated cycle_days rows instead of
-- max_members * cycle_days, started at day zero instead of the member's join
-- offset, and dropped cycle_number entirely. Any of those would have written a
-- wrong schedule for every future member.
--
-- So the existing definition is fetched and ONE expression is swapped: the
-- amount. Everything else — the status guard, the offset, the cycle number, the
-- duplicate check, the return value — is left exactly as it was, and the
-- replacement is asserted so a changed function raises rather than being
-- silently rebuilt from an assumption.
DO $mig$
DECLARE v_def text; v_before text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'generate_membership_schedule';

  IF v_def IS NULL THEN RAISE EXCEPTION 'generate_membership_schedule() not found'; END IF;
  v_before := v_def;

  -- Resolve the portion's amount once, before the loop.
  v_def := replace(v_def,
    '  v_inserted   INTEGER := 0;',
    '  v_inserted   INTEGER := 0;' || chr(10) ||
    '  v_amount     NUMERIC;');

  v_def := replace(v_def,
    '  v_frac := COALESCE((to_jsonb(v_mem)->>''slot_fraction'')::NUMERIC, 1);',
    '  v_frac := COALESCE((to_jsonb(v_mem)->>''slot_fraction'')::NUMERIC, 1);' || chr(10) || chr(10) ||
    '  -- The portion states what this member pays. A membership taken before' || chr(10) ||
    '  -- portions existed has none, so fall back to the old multiplication —' || chr(10) ||
    '  -- and because the backfill reproduced it exactly, the two agree.' || chr(10) ||
    '  SELECT gp.contribution_amount INTO v_amount' || chr(10) ||
    '  FROM group_portions gp WHERE gp.id = v_mem.portion_id;' || chr(10) ||
    '  IF v_amount IS NULL THEN' || chr(10) ||
    '    v_amount := ROUND(v_group.contribution_amount * v_frac, 2);' || chr(10) ||
    '  END IF;');

  v_def := replace(v_def,
    '              ROUND(v_group.contribution_amount * v_frac, 2),',
    '              v_amount,');

  IF v_def = v_before OR v_def NOT LIKE '%v_amount,%' THEN
    RAISE EXCEPTION 'generate_membership_schedule: expected expressions not found — review before rerunning';
  END IF;

  EXECUTE v_def;
END $mig$;


REVOKE ALL ON group_portions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON group_portions TO service_role;
