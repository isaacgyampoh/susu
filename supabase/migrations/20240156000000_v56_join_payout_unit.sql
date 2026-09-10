-- ============================================================================
-- v56 — TAKING A SLOT, IN ONE STATEMENT
-- ============================================================================
-- Placement and insertion have to be one operation. Split across two round
-- trips they are a race: two members join the same group, both are told turn
-- #7 has room for a half, and both take it — 4/4 becomes 6/4.
--
-- v55's capacity trigger would catch that and refuse the second one, but
-- refusing a member who did nothing wrong is not a fix. Doing the placement and
-- the insert in one function, under the `FOR UPDATE` that
-- `place_in_payout_unit` already takes, means the second member simply gets the
-- next turn.
--
-- This also retires the five-attempt retry loop in `_shared/join.ts`. That loop
-- existed to survive UNIQUE(group_id, payout_position) collisions under
-- concurrent joins. v55 removed that constraint and the database now serialises
-- the decision, so the retry has nothing left to retry.
-- ============================================================================

CREATE OR REPLACE FUNCTION join_payout_unit(
  p_member_id     uuid,
  p_group_id      uuid,
  p_quarters      integer,
  p_fraction      numeric,
  p_portion_id    uuid    DEFAULT NULL,
  p_payout_amount numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_unit uuid;
  v_num  integer;
  v_date date;
  v_id   uuid;
BEGIN
  v_unit := place_in_payout_unit(p_group_id, p_quarters);

  SELECT unit_number, payout_date INTO v_num, v_date
  FROM payout_units WHERE id = v_unit;

  -- position and date are written from the turn rather than left to the mirror,
  -- so the row is correct the moment it exists — nothing ever observes a
  -- membership carrying a placeholder position.
  INSERT INTO group_memberships (
    member_id, group_id, payout_position, payout_date, status,
    payout_amount, slot_fraction, portion_id, payout_unit_id)
  VALUES (
    p_member_id, p_group_id, v_num, v_date, 'active',
    p_payout_amount, p_fraction, p_portion_id, v_unit)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'membership_id', v_id,
    'position',      v_num,
    'payout_date',   v_date,
    'shared',        (SELECT count(*) > 1 FROM group_memberships
                      WHERE payout_unit_id = v_unit AND status = 'active'));
END $$;

REVOKE ALL ON FUNCTION join_payout_unit(uuid, uuid, integer, numeric, uuid, numeric)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION join_payout_unit(uuid, uuid, integer, numeric, uuid, numeric)
  TO service_role;

-- ============================================================================
-- THE NEXT FREE TURN IN A GROUP
-- ============================================================================
-- Used when a slot leaves a shared turn: it needs a turn of its own, and which
-- one that is has to be decided where the turns are, not in a round trip that
-- another join can invalidate mid-flight.
-- ============================================================================

CREATE OR REPLACE FUNCTION next_free_unit_number(p_group_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(MIN(n), 1)
  FROM generate_series(
    1,
    COALESCE((SELECT MAX(unit_number) FROM payout_units WHERE group_id = p_group_id), 0) + 1
  ) n
  WHERE NOT EXISTS (
    SELECT 1 FROM payout_units pu
    WHERE pu.group_id = p_group_id AND pu.unit_number = n);
$$;

REVOKE ALL ON FUNCTION next_free_unit_number(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION next_free_unit_number(uuid) TO service_role;

-- ============================================================================
-- shared_slot_key IS RETIRED
-- ============================================================================
-- v16 introduced it to mean "these slots share a turn". Sharing a turn is now
-- what `payout_unit_id` says, exactly and structurally, and two columns
-- claiming the same fact is how they come to disagree.
--
-- The column is kept, not dropped: it records which pairings an administrator
-- made by hand under the old model, including the 0.5+1.0 pairing that v55
-- deliberately did not consolidate. That is evidence for the person who has to
-- decide what happens to it, and dropping it would destroy the only trace.
-- Nothing reads it any more.
-- ============================================================================

COMMENT ON COLUMN group_memberships.shared_slot_key IS
  'RETIRED (v56). Historical record of v16-era manual pairings. Sharing a '
  'payout turn is now expressed by payout_unit_id. Not read by any code path; '
  'retained as evidence for pairings v55 declined to consolidate.';
