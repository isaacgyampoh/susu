-- ============================================================================
-- v55 — THE PAYOUT UNIT IS THE TURN. THE MEMBERSHIP IS A SHARE OF IT.
-- ============================================================================
--
-- ── THE BUG THIS FIXES ──────────────────────────────────────────────────────
--
-- Two half slots are one turn. Four quarters are one turn. The people in that
-- turn collect on the SAME day under the SAME number, because there is only one
-- turn — that is what "half a slot" means.
--
-- The system could not represent that. v15 said so in its own header: "Every
-- slot — whatever its size — still owns its own payout position in the
-- rotation." So two halves took two positions, and `activate_group` derives the
-- date from the position:
--
--     v_payout_date := p_start_date + (payout_position * cycle_days);
--
-- Different positions, therefore different dates, one cycle apart. In
-- production: two paired halves at positions 1 and 4; another pair at 3 and 15.
--
-- v16 tried to patch this by syncing `payout_date` across partners sharing a
-- `shared_slot_key`. It could never sync the NUMBER, because of:
--
--     UNIQUE (group_id, payout_position)
--
-- The database physically forbade two members holding one turn. No amount of
-- application code was going to fix that, which is why this is a migration and
-- not a patch.
--
-- ── THE MODEL ───────────────────────────────────────────────────────────────
--
--     susu_groups ──< payout_units ──< group_memberships
--
-- A unit is a turn: a number and a date, owned by the group. A membership is a
-- share of a turn. Uniqueness moves to `payout_units(group_id, unit_number)` —
-- the table where it is actually true — and off the membership, where it was a
-- lie about the business.
--
-- ── WHY payout_position AND payout_date STAY ON THE MEMBERSHIP ──────────────
--
-- 94 references across 22 files read them, including every financial path:
-- statements, reconciliation, forfeiture, reports, the payments workspace.
-- Rewriting all of those in the same change that alters the rotation model is
-- how a rotation fix turns into a money bug.
--
-- So they stay, as a MIRROR of the unit, maintained by trigger. Every existing
-- reader keeps working untouched — and starts showing the shared number and the
-- shared date automatically, because that is now what the columns contain. The
-- unit is the source of truth; these two columns are its shadow.
--
-- ── INTEGERS, NOT FRACTIONS ─────────────────────────────────────────────────
--
-- Capacity is counted in quarters: full = 4, half = 2, quarter = 1, a full unit
-- = 4. Four quarters sum to exactly 4. Four 0.25s sum to whatever binary
-- floating point feels like that day, and "is this unit full?" is not a
-- question that may ever be answered approximately.
--
-- Reversible: see the `down` notes at the foot of this file.
-- ============================================================================

BEGIN;

-- ── 1. QUARTERS ─────────────────────────────────────────────────────────────
-- Derived, so it cannot drift from slot_fraction. Every existing row is
-- 0.25/0.5/1 by CHECK constraint, so this is total.

ALTER TABLE group_memberships
  ADD COLUMN IF NOT EXISTS slot_quarters SMALLINT
  GENERATED ALWAYS AS (
    CASE slot_fraction WHEN 1 THEN 4 WHEN 0.5 THEN 2 WHEN 0.25 THEN 1 ELSE 4 END
  ) STORED;

COMMENT ON COLUMN group_memberships.slot_quarters IS
  'slot_fraction as an integer count of quarter-shares. Full=4, half=2, '
  'quarter=1. A payout unit holds exactly 4. Integer so that "is this unit '
  'full?" is exact.';

-- ── 2. THE TURN ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS payout_units (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      uuid NOT NULL REFERENCES susu_groups(id) ON DELETE CASCADE,
  unit_number   integer NOT NULL,
  payout_date   date,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payout_units_group_number_key UNIQUE (group_id, unit_number),
  CONSTRAINT payout_units_number_positive  CHECK (unit_number > 0)
);

COMMENT ON TABLE payout_units IS
  'One turn in a group rotation: a number and a date. Several memberships may '
  'share one unit when their slots are fractional — two halves, four quarters, '
  'a half and two quarters. They collect together, on this date, under this '
  'number. The unit owns the date; the membership owns its share.';

CREATE INDEX IF NOT EXISTS idx_payout_units_group ON payout_units(group_id);
CREATE INDEX IF NOT EXISTS idx_payout_units_date  ON payout_units(group_id, payout_date);

DROP TRIGGER IF EXISTS trg_payout_units_updated_at ON payout_units;
CREATE TRIGGER trg_payout_units_updated_at
  BEFORE UPDATE ON payout_units FOR EACH ROW EXECUTE FUNCTION fn_updated_at();

ALTER TABLE group_memberships
  ADD COLUMN IF NOT EXISTS payout_unit_id uuid REFERENCES payout_units(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_gm_payout_unit
  ON group_memberships(payout_unit_id) WHERE payout_unit_id IS NOT NULL;

COMMIT;

-- ============================================================================
-- 3. BACKFILL — ONE UNIT PER EXISTING MEMBERSHIP
-- ============================================================================
-- Deliberately not clever. Every membership keeps the exact number and the
-- exact date it has today. Nothing moves, nothing merges, no date changes, no
-- payout is re-attributed. Afterwards the system behaves identically — it just
-- has somewhere to put a shared turn.
--
-- Positions in production are sparse, not 1..max_members (one group has
-- max_members 15 and a live position 95), so unit_number copies payout_position
-- rather than renumbering. Renumbering would move every member's slot in the
-- name of tidiness.
-- ============================================================================

BEGIN;

INSERT INTO payout_units (group_id, unit_number, payout_date)
SELECT gm.group_id, gm.payout_position, MIN(gm.payout_date)
FROM group_memberships gm
WHERE gm.payout_unit_id IS NULL
GROUP BY gm.group_id, gm.payout_position
ON CONFLICT (group_id, unit_number) DO NOTHING;

UPDATE group_memberships gm
SET payout_unit_id = pu.id
FROM payout_units pu
WHERE pu.group_id = gm.group_id
  AND pu.unit_number = gm.payout_position
  AND gm.payout_unit_id IS NULL;

DO $$
DECLARE v_orphans integer;
BEGIN
  SELECT count(*) INTO v_orphans FROM group_memberships WHERE payout_unit_id IS NULL;
  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'v55 backfill incomplete: % memberships have no payout unit', v_orphans;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- 4. CONSOLIDATION — ONLY WHERE IT IS SAFE
-- ============================================================================
-- v16 pairing recorded the administrator's intent ("these slots share a turn")
-- but could only ever act on the date. Those pairs are the one place where the
-- intended unit is already known, so they are the one place worth merging.
--
-- ── WHAT IS DELIBERATELY LEFT ALONE ─────────────────────────────────────────
--
-- Merging changes a membership's payout NUMBER. Where money has already moved
-- against that number, changing it rewrites history to make a report tidier,
-- and this system does not do that. So a pair is consolidated only when ALL of:
--
--   * the shares sum to exactly one full unit (4 quarters);
--   * no membership in the set has collected (payout_received);
--   * no membership in the set has a settled `payouts` row.
--
-- Against production this merges exactly one pair — two halves in "Land Group 2
-- (30 Days)", a group that has not started, positions 3 and 15, no dates set,
-- nothing paid.
--
-- It deliberately does NOT touch:
--
--   * a 0.5+0.5 pair in "Daily Susu Payment 15days Pickup 1" where one half has
--     ALREADY COLLECTED. The two are right that they share a turn; merging them
--     now would move a position that a settled payout is attributed to.
--   * a 0.5+1.0 pair in the same group summing to 1.5 — not a unit at all, and
--     both sides already paid. That pairing should never have been accepted;
--     §5 of this migration is what stops the next one.
--
-- Both are reported to the administrator rather than silently corrected. A
-- human decides what happens to money that has already moved.
-- ============================================================================

BEGIN;

WITH candidate AS (
  SELECT gm.group_id, gm.shared_slot_key
  FROM group_memberships gm
  WHERE gm.shared_slot_key IS NOT NULL
  GROUP BY gm.group_id, gm.shared_slot_key
  HAVING SUM(gm.slot_quarters) = 4
     AND bool_and(NOT COALESCE(gm.payout_received, false))
     AND NOT EXISTS (
       SELECT 1 FROM payouts p
       JOIN group_memberships g2 ON g2.id = p.membership_id
       WHERE g2.shared_slot_key = gm.shared_slot_key
         AND g2.group_id = gm.group_id
         AND p.status = 'paid')
),
-- The turn they keep is the earliest one, so the rotation never moves later.
keeper AS (
  SELECT DISTINCT ON (c.group_id, c.shared_slot_key)
         c.group_id, c.shared_slot_key, gm.payout_unit_id AS unit_id
  FROM candidate c
  JOIN group_memberships gm
    ON gm.group_id = c.group_id AND gm.shared_slot_key = c.shared_slot_key
  ORDER BY c.group_id, c.shared_slot_key, gm.payout_position
)
UPDATE group_memberships gm
SET payout_unit_id = k.unit_id
FROM keeper k
WHERE gm.group_id = k.group_id
  AND gm.shared_slot_key = k.shared_slot_key
  AND gm.payout_unit_id IS DISTINCT FROM k.unit_id;

-- Units nobody occupies any more are free turns, not history. Removing them
-- keeps the rotation honest about how many turns are actually taken.
DELETE FROM payout_units pu
WHERE NOT EXISTS (SELECT 1 FROM group_memberships gm WHERE gm.payout_unit_id = pu.id);

COMMIT;

-- ============================================================================
-- 5. A UNIT HOLDS EXACTLY FOUR QUARTERS, AND NEVER MORE
-- ============================================================================
-- This is the rule v16 pairing never had, and its absence is visible in
-- production: a half paired with a full slot, summing to one and a half turns,
-- accepted silently.
--
-- Only ACTIVE shares count. When a member forfeits, their share of the turn
-- genuinely frees up for a replacement — that is what forfeiture means — while
-- their row stays for the history.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_payout_unit_capacity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_quarters integer;
  v_number   integer;
BEGIN
  IF NEW.payout_unit_id IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(SUM(gm.slot_quarters), 0) INTO v_quarters
  FROM group_memberships gm
  WHERE gm.payout_unit_id = NEW.payout_unit_id AND gm.status = 'active';

  IF v_quarters > 4 THEN
    SELECT unit_number INTO v_number FROM payout_units WHERE id = NEW.payout_unit_id;
    RAISE EXCEPTION
      'Payout turn #% is already full. A turn holds four quarter-shares — one '
      'full slot, two halves, or four quarters — and this would make % of 4.',
      v_number, v_quarters
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_payout_unit_capacity ON group_memberships;
CREATE CONSTRAINT TRIGGER trg_payout_unit_capacity
  AFTER INSERT OR UPDATE OF payout_unit_id, slot_fraction, status ON group_memberships
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_payout_unit_capacity();

-- ── The constraint that made the bug unfixable ──────────────────────────────
-- UNIQUE(group_id, payout_position) said "one member, one turn". That is not
-- true of this business and never was. Uniqueness now sits on payout_units,
-- where a turn number genuinely is unique within its group.
ALTER TABLE group_memberships
  DROP CONSTRAINT IF EXISTS group_memberships_group_id_payout_position_key;

COMMIT;

-- ============================================================================
-- 6. THE MIRROR
-- ============================================================================
-- `payout_position` and `payout_date` on the membership are now a shadow of the
-- unit, kept exact by these two triggers. Every one of the 94 existing readers
-- keeps working with no change, and starts reporting the shared turn because
-- that is now what the columns hold.
--
-- Writers keep working too: an administrator setting a payout date on one
-- membership is, correctly, setting it for everyone sharing that turn. That
-- used to require the v16 partner-sync loop in admin-members; now it is simply
-- what the data means.
--
-- ── TERMINATION ─────────────────────────────────────────────────────────────
-- Down-mirror writes memberships only where they differ; up-mirror writes the
-- unit only where it differs. A change bounces at most once: the second pass
-- finds everything equal and stops. Moving a membership BETWEEN units mirrors
-- DOWN only — otherwise a slot joining turn #3 would drag its old number 15
-- onto turn #3 and renumber the turn it just joined.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_payout_unit_mirror_down()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE group_memberships
  SET payout_position = NEW.unit_number,
      payout_date     = NEW.payout_date
  WHERE payout_unit_id = NEW.id
    AND (payout_position IS DISTINCT FROM NEW.unit_number
      OR payout_date     IS DISTINCT FROM NEW.payout_date);
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_payout_unit_mirror_down ON payout_units;
CREATE TRIGGER trg_payout_unit_mirror_down
  AFTER INSERT OR UPDATE OF unit_number, payout_date ON payout_units
  FOR EACH ROW EXECUTE FUNCTION fn_payout_unit_mirror_down();

CREATE OR REPLACE FUNCTION fn_membership_unit_mirror_up()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE u payout_units%ROWTYPE;
BEGIN
  IF NEW.payout_unit_id IS NULL THEN RETURN NULL; END IF;

  SELECT * INTO u FROM payout_units WHERE id = NEW.payout_unit_id;
  IF u.id IS NULL THEN RETURN NULL; END IF;

  -- Joining a different turn: adopt that turn. Never impose the old number on it.
  IF TG_OP = 'INSERT' OR NEW.payout_unit_id IS DISTINCT FROM OLD.payout_unit_id THEN
    IF NEW.payout_position IS DISTINCT FROM u.unit_number
       OR NEW.payout_date  IS DISTINCT FROM u.payout_date THEN
      UPDATE group_memberships
      SET payout_position = u.unit_number, payout_date = u.payout_date
      WHERE id = NEW.id;
    END IF;
    RETURN NULL;
  END IF;

  -- Editing the turn through one of its members changes the turn itself, so
  -- every member sharing it moves together.
  IF NEW.payout_position IS DISTINCT FROM u.unit_number
     OR NEW.payout_date  IS DISTINCT FROM u.payout_date THEN
    UPDATE payout_units
    SET unit_number = NEW.payout_position, payout_date = NEW.payout_date
    WHERE id = u.id;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_membership_unit_mirror_up ON group_memberships;
CREATE TRIGGER trg_membership_unit_mirror_up
  AFTER INSERT OR UPDATE OF payout_position, payout_date, payout_unit_id ON group_memberships
  FOR EACH ROW EXECUTE FUNCTION fn_membership_unit_mirror_up();

-- One-time sync: §4 moved memberships between units before these triggers
-- existed, so the shadow columns still hold their old numbers.
UPDATE group_memberships gm
SET payout_position = pu.unit_number,
    payout_date     = pu.payout_date
FROM payout_units pu
WHERE pu.id = gm.payout_unit_id
  AND (gm.payout_position IS DISTINCT FROM pu.unit_number
    OR gm.payout_date     IS DISTINCT FROM pu.payout_date);

COMMIT;

-- ============================================================================
-- 7. PLACEMENT — WHICH TURN DOES THIS SLOT JOIN?
-- ============================================================================
-- The one place that decides. Every join path calls this, so a half taken from
-- the member portal, a half added by an administrator, and a half approved from
-- an application all land the same way. Copying this logic per path is exactly
-- how `× fraction` ended up in five files.
--
-- ── THE RULE ────────────────────────────────────────────────────────────────
--
--   A full slot (4/4) always takes a turn of its own — it cannot share.
--   A fractional slot joins the EARLIEST turn IN THIS GROUP that has room,
--   and opens a new turn only when none has.
--
-- So a half joins a waiting half and they collect together; two quarters make a
-- half-full turn that the next two quarters complete. A turn is never treated
-- as full before its four quarters are actually there — an incomplete turn
-- still has a number and a date, it simply has room left in it.
--
-- ── WITHIN THE GROUP, ALWAYS ────────────────────────────────────────────────
--
-- `WHERE pu.group_id = p_group_id` is the whole of §4 of the brief: a half in
-- Land Group 2 can never pair with a half in Birthday Group 1. Rotations are
-- separate contexts and the money never meets.
--
-- ── TURNS THAT ARE NO LONGER JOINABLE ───────────────────────────────────────
--
-- A turn somebody has already collected on is closed: joining it would promise
-- a payout on a date that has passed and been paid. Those are skipped.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION place_in_payout_unit(
  p_group_id uuid,
  p_quarters integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_unit_id uuid;
  v_number  integer;
BEGIN
  IF p_quarters IS NULL OR p_quarters < 1 OR p_quarters > 4 THEN
    RAISE EXCEPTION 'A slot is one to four quarter-shares, not %', p_quarters
      USING ERRCODE = 'check_violation';
  END IF;

  -- A whole slot never shares, so do not even look for a partner.
  IF p_quarters < 4 THEN
    SELECT pu.id INTO v_unit_id
    FROM payout_units pu
    WHERE pu.group_id = p_group_id
      AND NOT EXISTS (
        SELECT 1 FROM group_memberships gm
        WHERE gm.payout_unit_id = pu.id
          AND COALESCE(gm.payout_received, false))
      AND COALESCE((
        SELECT SUM(gm.slot_quarters) FROM group_memberships gm
        WHERE gm.payout_unit_id = pu.id AND gm.status = 'active'), 0) + p_quarters <= 4
      AND EXISTS (
        SELECT 1 FROM group_memberships gm
        WHERE gm.payout_unit_id = pu.id AND gm.status = 'active')
    ORDER BY pu.unit_number
    LIMIT 1
    FOR UPDATE;

    IF v_unit_id IS NOT NULL THEN RETURN v_unit_id; END IF;
  END IF;

  -- No room anywhere: open the next free turn in this group.
  SELECT COALESCE(MIN(n), 1) INTO v_number
  FROM generate_series(1, COALESCE((SELECT MAX(unit_number) FROM payout_units
                                    WHERE group_id = p_group_id), 0) + 1) n
  WHERE NOT EXISTS (
    SELECT 1 FROM payout_units pu
    WHERE pu.group_id = p_group_id AND pu.unit_number = n);

  INSERT INTO payout_units (group_id, unit_number) VALUES (p_group_id, v_number)
  RETURNING id INTO v_unit_id;

  RETURN v_unit_id;
END $$;

COMMENT ON FUNCTION place_in_payout_unit IS
  'Decides which turn a new slot of p_quarters quarter-shares joins in this '
  'group: the earliest turn with room, or a new one. The single placement rule '
  'for every join path.';

REVOKE ALL ON FUNCTION place_in_payout_unit(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION place_in_payout_unit(uuid, integer) TO service_role;

-- ── Moving a slot onto a turn by hand ───────────────────────────────────────
-- What v16 pairing was reaching for, done properly: the number is shared, not
-- just the date, and a turn that would overflow is refused rather than accepted
-- silently the way a half-plus-full pairing once was.
CREATE OR REPLACE FUNCTION assign_membership_to_unit(
  p_membership_id uuid,
  p_unit_number   integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mem     group_memberships%ROWTYPE;
  v_unit    payout_units%ROWTYPE;
  v_old     uuid;
  v_taken   integer;
BEGIN
  SELECT * INTO v_mem FROM group_memberships WHERE id = p_membership_id;
  IF v_mem.id IS NULL THEN RAISE EXCEPTION 'Membership not found'; END IF;

  IF COALESCE(v_mem.payout_received, false) THEN
    RAISE EXCEPTION
      'This slot has already collected. Moving it would re-attribute a payout '
      'that has been paid.'
      USING ERRCODE = 'check_violation';
  END IF;

  v_old := v_mem.payout_unit_id;

  SELECT * INTO v_unit FROM payout_units
  WHERE group_id = v_mem.group_id AND unit_number = p_unit_number;

  IF v_unit.id IS NULL THEN
    INSERT INTO payout_units (group_id, unit_number)
    VALUES (v_mem.group_id, p_unit_number)
    RETURNING * INTO v_unit;
  END IF;

  IF v_unit.id = v_old THEN
    RETURN jsonb_build_object('unit_number', v_unit.unit_number, 'moved', false);
  END IF;

  SELECT COALESCE(SUM(gm.slot_quarters), 0) INTO v_taken
  FROM group_memberships gm
  WHERE gm.payout_unit_id = v_unit.id AND gm.status = 'active' AND gm.id <> p_membership_id;

  IF v_taken + v_mem.slot_quarters > 4 THEN
    RAISE EXCEPTION
      'Turn #% holds %/4 quarter-shares already, and this slot needs %. A turn '
      'is one full slot, two halves, or four quarters.',
      p_unit_number, v_taken, v_mem.slot_quarters
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE group_memberships SET payout_unit_id = v_unit.id WHERE id = p_membership_id;

  -- A turn nobody holds any more is a free turn, not history.
  DELETE FROM payout_units pu
  WHERE pu.id = v_old
    AND NOT EXISTS (SELECT 1 FROM group_memberships gm WHERE gm.payout_unit_id = pu.id);

  RETURN jsonb_build_object(
    'unit_number', v_unit.unit_number,
    'payout_date', v_unit.payout_date,
    'moved',       true,
    'quarters',    v_taken + v_mem.slot_quarters);
END $$;

REVOKE ALL ON FUNCTION assign_membership_to_unit(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION assign_membership_to_unit(uuid, integer) TO service_role;

COMMIT;

-- ============================================================================
-- 8. activate_group — DATES BELONG TO THE TURN
-- ============================================================================
-- The one line that produced the bug:
--
--     v_payout_date := p_start_date + (v_mem.payout_position * cycle_days);
--
-- Per membership. Two halves at positions 1 and 4, one cycle apart, for a turn
-- they share. Now the schedule is written to `payout_units` once per turn and
-- the mirror carries it to everyone holding a share of it — so two halves
-- cannot come out on different days, because only one date was ever computed.
--
-- ── ONE OTHER CORRECTION, DELIBERATE ────────────────────────────────────────
--
-- The old recompute path also overwrote the payout amount with
-- `cashout × slot_fraction`. v49 established that portions are configuration,
-- not a multiplication — an administrator can set what a half collects, and it
-- need not be exactly half. This function was the last place still multiplying,
-- so re-activating a group with recompute silently discarded configured portion
-- amounts. It now reads the portion, and falls back to the old multiplication
-- only for memberships taken before portions existed — which the v49 backfill
-- reproduced exactly, so the two agree.
--
-- Everything else in this function is unchanged from the deployed definition.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION activate_group(
  p_group_id          UUID,
  p_start_date        DATE,
  p_force             BOOLEAN DEFAULT false,
  p_allow_past        BOOLEAN DEFAULT false,
  p_recompute_payouts BOOLEAN DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp AS $$
DECLARE
  v_group        susu_groups%ROWTYPE;
  v_mem          group_memberships%ROWTYPE;
  v_cashout      DECIMAL(10,2);
  v_total_days   INTEGER;
  v_paid_count   INTEGER;
  v_end_date     DATE;
  v_mem_start    DATE;
  v_offset       INTEGER;
  v_payout_date  DATE;
  v_payout_amt   DECIMAL(10,2);
  v_recompute    BOOLEAN;
  v_frac         NUMERIC(3,2);
  v_portion_pay  DECIMAL(10,2);
  v_portion_con  DECIMAL(10,2);
BEGIN
  SELECT * INTO v_group FROM susu_groups WHERE id = p_group_id;
  IF v_group.id IS NULL THEN RAISE EXCEPTION 'Group not found'; END IF;

  IF v_group.status = 'completed' THEN
    RAISE EXCEPTION 'This group has completed and cannot be re-activated';
  END IF;

  IF p_start_date < CURRENT_DATE AND NOT p_allow_past THEN
    RAISE EXCEPTION 'Start date is in the past. Tick the confirmation to backdate a group that genuinely started on %.', p_start_date;
  END IF;

  IF v_group.status = 'active' AND NOT p_force THEN
    SELECT COUNT(*) INTO v_paid_count
    FROM contributions WHERE group_id = p_group_id AND status = 'paid';
    IF v_paid_count > 0 THEN
      RAISE EXCEPTION 'Group is already active with % paid contributions. Re-activating would rebuild the schedule and move collection dates.', v_paid_count;
    END IF;
  END IF;

  IF (SELECT COUNT(*) FROM group_memberships WHERE group_id = p_group_id AND status = 'active') = 0 THEN
    RAISE EXCEPTION 'Cannot activate a group with no active members';
  END IF;

  v_cashout    := COALESCE(v_group.cashout_amount,
                    v_group.contribution_amount * v_group.max_members * v_group.cycle_days);
  v_total_days := v_group.max_members * v_group.cycle_days;
  v_end_date   := p_start_date + v_total_days;
  v_recompute  := COALESCE(p_recompute_payouts, p_force);

  UPDATE susu_groups
  SET start_date = p_start_date, end_date = v_end_date, status = 'active'
  WHERE id = p_group_id;

  DELETE FROM contributions WHERE group_id = p_group_id AND status IN ('pending','overdue');
  DELETE FROM payouts       WHERE group_id = p_group_id AND status = 'upcoming';

  -- ── THE SCHEDULE, ONCE PER TURN ───────────────────────────────────────────
  -- Written to the unit. The mirror carries each date down to every share of
  -- that turn, so two halves cannot receive different days.
  IF v_recompute THEN
    UPDATE payout_units
    SET payout_date = p_start_date + (unit_number * v_group.cycle_days)
    WHERE group_id = p_group_id;
  ELSE
    UPDATE payout_units
    SET payout_date = COALESCE(payout_date, p_start_date + (unit_number * v_group.cycle_days))
    WHERE group_id = p_group_id;
  END IF;

  FOR v_mem IN
    SELECT * FROM group_memberships
    WHERE group_id = p_group_id AND status = 'active'
    ORDER BY payout_position
  LOOP
    v_mem_start := GREATEST(p_start_date, COALESCE(v_mem.joined_at::DATE, p_start_date));
    v_frac      := COALESCE(v_mem.slot_fraction, 1);

    -- The portion states what this slot collects and pays. Only a membership
    -- from before portions existed falls back to the multiplication.
    SELECT gp.payout_amount, gp.contribution_amount
      INTO v_portion_pay, v_portion_con
    FROM group_portions gp WHERE gp.id = v_mem.portion_id;

    -- The date is the turn's, already mirrored onto this row above.
    v_payout_date := v_mem.payout_date;

    IF v_recompute THEN
      v_payout_amt := COALESCE(v_portion_pay, ROUND(v_cashout * v_frac, 2));
    ELSE
      v_payout_amt := COALESCE(v_mem.payout_amount, v_portion_pay, ROUND(v_cashout * v_frac, 2));
    END IF;

    UPDATE group_memberships
    SET payout_amount = v_payout_amt
    WHERE id = v_mem.id;

    IF NOT COALESCE(v_mem.payout_received, false) AND v_payout_date IS NOT NULL THEN
      INSERT INTO payouts (member_id, group_id, membership_id, total_amount, scheduled_date, status)
      VALUES (v_mem.member_id, p_group_id, v_mem.id, v_payout_amt, v_payout_date, 'upcoming');
    END IF;

    v_offset := v_mem_start - p_start_date;
    IF v_offset < 0 THEN v_offset := 0; END IF;

    FOR i IN v_offset..(v_total_days - 1) LOOP
      IF NOT EXISTS (
        SELECT 1 FROM contributions
        WHERE membership_id = v_mem.id AND due_date = p_start_date + i
      ) THEN
        INSERT INTO contributions (member_id, group_id, membership_id, amount, due_date, status, cycle_number)
        VALUES (v_mem.member_id, p_group_id, v_mem.id,
                COALESCE(v_portion_con, ROUND(v_group.contribution_amount * v_frac, 2)),
                p_start_date + i, 'pending', FLOOR(i::FLOAT / v_group.cycle_days) + 1);
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

COMMIT;

-- ============================================================================
-- 9. THE MEMBER'S VIEW — ONE ROW PER TURN, NOT PER PERSON
-- ============================================================================
-- v54 listed one seat per membership, so a shared turn appeared twice: two
-- rows, one number, and no way for a member to tell whether that was a mistake.
-- A turn is now one row, whoever is in it.
--
-- ── THE PRIVACY GUARANTEE IS UNCHANGED AND STILL STRUCTURAL ─────────────────
--
-- This function still does not join `members`. Not "joins and filters" — the
-- table does not appear. There is no name, phone, email or Ghana Card that a
-- later edit could widen a SELECT onto.
--
-- `group_memberships` is read only through the caller's own member_id, or to
-- answer two questions about a turn that carry nothing personal: has this turn
-- collected, and does the caller hold a share of it. What another member
-- collects is never selected — not filtered afterwards, never selected.
--
-- A member IS told that their OWN turn is shared, and what their own share is.
-- That is their own membership, and a half-slot holder who cannot see that they
-- hold a half cannot check their own payout is right.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION get_member_rotation(
  p_member_id     uuid,
  p_membership_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH mine AS (
    SELECT gm.id, gm.group_id, gm.payout_unit_id, gm.payout_position, gm.payout_date,
           gm.payout_amount, gm.payout_received, gm.slot_fraction, gm.slot_quarters
    FROM group_memberships gm
    WHERE gm.member_id = p_member_id
      AND gm.status = 'active'
      AND (p_membership_id IS NULL OR gm.id = p_membership_id)
  ),
  target AS (
    SELECT * FROM mine ORDER BY payout_date NULLS LAST, payout_position LIMIT 1
  ),
  -- Every turn in that group. One row each, however many people share it.
  seats AS (
    SELECT
      pu.id,
      pu.unit_number AS position,
      pu.payout_date AS date,
      EXISTS (
        SELECT 1 FROM group_memberships gm
        WHERE gm.payout_unit_id = pu.id
          AND gm.member_id = p_member_id
          AND gm.status = 'active'
      ) AS is_you,
      COALESCE((
        SELECT bool_and(COALESCE(gm.payout_received, false))
        FROM group_memberships gm
        WHERE gm.payout_unit_id = pu.id AND gm.status = 'active'
      ), false) AS received,
      -- The caller's own figure. No subquery here reads anyone else's amount.
      (
        SELECT gm.payout_amount FROM group_memberships gm
        WHERE gm.payout_unit_id = pu.id
          AND gm.member_id = p_member_id
          AND gm.status = 'active'
        LIMIT 1
      ) AS amount
    FROM payout_units pu
    JOIN target t ON t.group_id = pu.group_id
  ),
  nxt AS (
    SELECT * FROM seats
    WHERE date IS NOT NULL AND NOT received AND date >= CURRENT_DATE
    ORDER BY date, position LIMIT 1
  )
  SELECT jsonb_build_object(
    'group', (
      SELECT jsonb_build_object('id', g.id, 'name', g.name,
                                'payment_deadline', g.payment_deadline)
      FROM susu_groups g JOIN target t ON t.group_id = g.id
    ),
    'next', (
      SELECT jsonb_build_object('position', n.position, 'date', n.date, 'is_you', n.is_you)
      FROM nxt n
    ),
    'mine', (
      SELECT jsonb_build_object(
        'membership_id', t.id,
        'position',      t.payout_position,
        'date',          t.payout_date,
        'amount',        t.payout_amount,
        'received',      COALESCE(t.payout_received, false),
        'slot_fraction', t.slot_fraction,
        'share_label',   CASE t.slot_quarters WHEN 4 THEN 'Full slot'
                                              WHEN 2 THEN 'Half slot'
                                              WHEN 1 THEN 'Quarter slot' END,
        -- Their own turn, and whether they hold it with somebody. Who, and for
        -- how much, is never returned.
        'shares_turn',   COALESCE((
                           SELECT count(*) > 1 FROM group_memberships gm
                           WHERE gm.payout_unit_id = t.payout_unit_id
                             AND gm.status = 'active'), false),
        'is_next',       EXISTS (SELECT 1 FROM nxt n WHERE n.id = t.payout_unit_id)
      ) FROM target t
    ),
    'upcoming', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'position', s.position, 'date', s.date,
               'is_you', s.is_you, 'received', s.received,
               'amount', CASE WHEN s.is_you THEN s.amount END)
             ORDER BY s.date NULLS LAST, s.position)
      FROM seats s
      WHERE NOT s.received AND (s.date IS NULL OR s.date >= CURRENT_DATE)
    ), '[]'::jsonb),
    'collected',   (SELECT count(*) FROM seats WHERE received),
    'total_slots', (SELECT count(*) FROM seats)
  )
  WHERE EXISTS (SELECT 1 FROM target);
$$;

REVOKE ALL ON FUNCTION get_member_rotation(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_member_rotation(uuid, uuid) TO service_role;

-- ============================================================================
-- 10. THE ADMINISTRATOR'S VIEW — TURNS, WITH WHO IS IN THEM
-- ============================================================================
-- The admin portal showed one row per member, so a shared turn read as two
-- separate payouts on the same day and nothing said why. This returns the
-- rotation the way it actually works: turns, each with its shares, and how full
-- each one is. Names appear here because this is the administrator's own group
-- roster — the member-facing function above still cannot see them.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_group_rotation(p_group_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'group', (SELECT jsonb_build_object('id', g.id, 'name', g.name,
                       'status', g.status, 'cycle_days', g.cycle_days,
                       'max_members', g.max_members, 'start_date', g.start_date)
              FROM susu_groups g WHERE g.id = p_group_id),
    'units', COALESCE((
      SELECT jsonb_agg(u ORDER BY (u->>'unit_number')::int)
      FROM (
        SELECT jsonb_build_object(
          'id',           pu.id,
          'unit_number',  pu.unit_number,
          'payout_date',  pu.payout_date,
          'quarters',     COALESCE(SUM(gm.slot_quarters) FILTER (WHERE gm.status='active'), 0),
          'complete',     COALESCE(SUM(gm.slot_quarters) FILTER (WHERE gm.status='active'), 0) = 4,
          'received',     COALESCE(bool_and(COALESCE(gm.payout_received,false))
                                   FILTER (WHERE gm.status='active'), false),
          'members',      COALESCE(jsonb_agg(jsonb_build_object(
                            'membership_id', gm.id,
                            'member_id',     gm.member_id,
                            'name',          m.full_name,
                            'slot_fraction', gm.slot_fraction,
                            'share_label',   CASE gm.slot_quarters WHEN 4 THEN 'Full'
                                                                   WHEN 2 THEN 'Half'
                                                                   WHEN 1 THEN 'Quarter' END,
                            'payout_amount', gm.payout_amount,
                            'received',      COALESCE(gm.payout_received,false),
                            'status',        gm.status)
                            ORDER BY gm.slot_quarters DESC, m.full_name)
                          FILTER (WHERE gm.id IS NOT NULL), '[]'::jsonb)
        ) AS u
        FROM payout_units pu
        LEFT JOIN group_memberships gm ON gm.payout_unit_id = pu.id
        LEFT JOIN members m ON m.id = gm.member_id
        WHERE pu.group_id = p_group_id
        GROUP BY pu.id, pu.unit_number, pu.payout_date
      ) s
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION get_group_rotation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_group_rotation(uuid) TO service_role;

COMMIT;

-- ============================================================================
-- REVERSING THIS
-- ============================================================================
-- The shadow columns still hold everything the old model needed, so:
--
--   DROP TRIGGER trg_membership_unit_mirror_up ON group_memberships;
--   DROP TRIGGER trg_payout_unit_mirror_down   ON payout_units;
--   DROP TRIGGER trg_payout_unit_capacity      ON group_memberships;
--   ALTER TABLE group_memberships DROP COLUMN payout_unit_id, DROP COLUMN slot_quarters;
--   DROP TABLE payout_units;
--   ALTER TABLE group_memberships
--     ADD CONSTRAINT group_memberships_group_id_payout_position_key
--     UNIQUE (group_id, payout_position);
--
-- The last step fails if any turn is genuinely shared by then — which is the
-- correct outcome: it is telling you that real data now depends on the fix.
-- ============================================================================
