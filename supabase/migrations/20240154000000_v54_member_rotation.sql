-- ============================================================================
-- v54 — THE ROTATION, AS A MEMBER IS ALLOWED TO SEE IT
-- ============================================================================
-- Read-only. Writes nothing.
--
-- ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
--
-- A member could see "Slot 8" and their own collection date, and nothing else.
-- Position without the rotation around it means very little: the point of
-- knowing somebody collects on 12 September is that it is why your contribution
-- matters this week.
--
-- ── WHAT IT DELIBERATELY CANNOT RETURN ──────────────────────────────────────
--
-- This function does not read the `members` table. Not "reads it and filters" —
-- does not join it at all. There is therefore no name, no phone, no Ghana Card
-- and no email that could be returned by mistake, by a later edit, or by
-- somebody adding a column to a SELECT *.
--
-- `payout_amount` is returned for the CALLER'S OWN row and NULL for everyone
-- else. What another member collects is their business; a rotation view needs
-- only position, date and status.
--
-- The alternative — sending the whole roster and hiding it in the component —
-- means every member's phone number is in the browser of every other member,
-- one devtools tab away. Privacy that depends on CSS is not privacy.
--
-- ── SCOPING ─────────────────────────────────────────────────────────────────
--
-- p_member_id comes from the caller's verified session, and appears in the
-- WHERE clause of the membership check rather than in a comparison afterwards.
-- A member who passes a membership_id they do not hold gets nothing back, which
-- is the same answer as a membership that does not exist.
-- ============================================================================

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
    -- The caller's own memberships. The scope, not an afterthought.
    SELECT gm.id, gm.group_id, gm.payout_position, gm.payout_date,
           gm.payout_amount, gm.payout_received
    FROM group_memberships gm
    WHERE gm.member_id = p_member_id
      AND gm.status = 'active'
      AND (p_membership_id IS NULL OR gm.id = p_membership_id)
  ),
  -- One group per call: the first of the caller's memberships, or the one asked
  -- for. A rotation belongs to a group, so mixing several would be meaningless.
  target AS (
    SELECT * FROM mine ORDER BY payout_date NULLS LAST, payout_position LIMIT 1
  ),
  -- Every slot in that group. NO JOIN TO `members` — see the header.
  seats AS (
    SELECT gm.id,
           gm.payout_position,
           gm.payout_date,
           gm.payout_received,
           (gm.member_id = p_member_id) AS is_you,
           -- Only the caller's own figure. NULL for everyone else's row.
           CASE WHEN gm.member_id = p_member_id THEN gm.payout_amount END AS amount
    FROM group_memberships gm
    JOIN target t ON t.group_id = gm.group_id
    WHERE gm.status = 'active'
  ),
  -- The next payout: earliest dated slot not yet collected, today or later.
  nxt AS (
    SELECT * FROM seats
    WHERE payout_date IS NOT NULL
      AND NOT COALESCE(payout_received, false)
      AND payout_date >= CURRENT_DATE
    ORDER BY payout_date, payout_position
    LIMIT 1
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM target) THEN NULL ELSE jsonb_build_object(
    'group', (SELECT jsonb_build_object(
                'id', g.id, 'name', g.name,
                'payment_deadline', g.payment_deadline)
              FROM target t JOIN susu_groups g ON g.id = t.group_id),

    'next', (SELECT jsonb_build_object(
               'position', n.payout_position,
               'date',     n.payout_date,
               'is_you',   n.is_you)
             FROM nxt n),

    'mine', (SELECT jsonb_build_object(
               'membership_id',   t.id,
               'position',        t.payout_position,
               'date',            t.payout_date,
               'amount',          t.payout_amount,
               'received',        COALESCE(t.payout_received, false),
               -- Whether the caller IS the next payout, so the interface never
               -- shows "next" and "yours" as two different people.
               'is_next', EXISTS (SELECT 1 FROM nxt n WHERE n.id = t.id))
             FROM target t),

    -- The upcoming order. Positions and dates only.
    'upcoming', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'position', s.payout_position,
               'date',     s.payout_date,
               'is_you',   s.is_you,
               'received', COALESCE(s.payout_received, false),
               'amount',   s.amount)
             ORDER BY s.payout_date NULLS LAST, s.payout_position)
      FROM seats s
      WHERE COALESCE(s.payout_received, false) = false
        AND (s.payout_date IS NULL OR s.payout_date >= CURRENT_DATE)
    ), '[]'::jsonb),

    'collected', (SELECT count(*) FROM seats WHERE COALESCE(payout_received,false)),
    'total_slots', (SELECT count(*) FROM seats)
  ) END;
$$;

REVOKE ALL ON FUNCTION get_member_rotation(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_member_rotation(uuid, uuid) TO service_role;
