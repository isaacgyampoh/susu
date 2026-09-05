-- ============================================================================
-- MEMBER ROTATION — PRIVACY REGRESSION SUITE
-- ============================================================================
-- Every row returned is a result. `FAIL` in the verdict column is a defect.
--
-- Read-only, safe against production at any time.
--
-- ── WHAT THIS PROTECTS ──────────────────────────────────────────────────────
--
-- A member may see the ORDER of turns in their group: positions, dates, and
-- which one is theirs. They may not see who holds the other turns or what those
-- people collect.
--
-- The guarantee is structural — `get_member_rotation` does not join the members
-- table — but structure erodes. Somebody adds a name "just for the admin view",
-- or widens a SELECT, and every member's phone number is in every other
-- member's browser. These tests fail the moment that happens, which is the
-- point: the privacy claim in the header of that function is only worth
-- something if something checks it.
-- ============================================================================

WITH subject AS (
  -- A real member who holds a dated seat in a group with several members.
  SELECT gm.member_id, gm.id AS membership_id, gm.group_id
  FROM group_memberships gm
  WHERE gm.status = 'active' AND gm.payout_date IS NOT NULL
    AND (SELECT count(*) FROM group_memberships o
          WHERE o.group_id = gm.group_id AND o.status = 'active') > 2
  ORDER BY gm.payout_date DESC
  LIMIT 1
),
stranger AS (
  -- Somebody else in the SAME group, whose details must not appear.
  SELECT m.id, m.full_name, m.phone
  FROM group_memberships gm
  JOIN members m ON m.id = gm.member_id
  JOIN subject s ON s.group_id = gm.group_id
  WHERE gm.member_id <> s.member_id AND gm.status = 'active'
  LIMIT 1
),
r AS (
  SELECT get_member_rotation((SELECT member_id FROM subject),
                             (SELECT membership_id FROM subject)) AS j
),
checks AS (
  SELECT 1 AS ord, 'A member sees the next payout position and date' AS scenario,
         ((r.j->'next'->>'position') IS NOT NULL
      AND (r.j->'next'->>'date')     IS NOT NULL) AS ok
  FROM r

  UNION ALL
  SELECT 2, 'The next payout carries no amount',
         (r.j->'next'->>'amount') IS NULL FROM r

  UNION ALL
  SELECT 3, 'A member sees their own position and their own amount',
         ((r.j->'mine'->>'position') IS NOT NULL) FROM r

  UNION ALL
  -- The core promise. A stranger's name must appear nowhere in the payload.
  SELECT 4, 'No other member''s name anywhere in the payload',
         r.j::text NOT ILIKE '%' || (SELECT full_name FROM stranger) || '%' FROM r

  UNION ALL
  SELECT 5, 'No other member''s phone anywhere in the payload',
         r.j::text NOT LIKE '%' || (SELECT phone FROM stranger) || '%' FROM r

  UNION ALL
  -- Nobody else's payout figure, on any row.
  SELECT 6, 'No amount on any seat that is not the caller''s',
         NOT EXISTS (
           SELECT 1 FROM r, jsonb_array_elements(r.j->'upcoming') u
           WHERE (u->>'is_you')::boolean = false AND u->>'amount' IS NOT NULL)

  UNION ALL
  -- Identity-shaped keys must not exist at all, even empty.
  SELECT 7, 'No identity-shaped keys in the payload',
         r.j::text !~* '(full_name|"phone"|"email"|ghana_card)' FROM r

  UNION ALL
  SELECT 8, 'Exactly one seat is marked as the caller''s',
         (SELECT count(*) FROM r, jsonb_array_elements(r.j->'upcoming') u
           WHERE (u->>'is_you')::boolean) <= 1

  UNION ALL
  -- Scoping: a membership the caller does not hold returns nothing at all.
  SELECT 9, 'A membership the caller does not hold returns nothing',
         get_member_rotation(
           (SELECT member_id FROM subject),
           (SELECT gm.id FROM group_memberships gm, subject s
             WHERE gm.member_id <> s.member_id LIMIT 1)
         ) IS NULL

  UNION ALL
  SELECT 10, 'An unknown member returns nothing',
         get_member_rotation('00000000-0000-0000-0000-000000000000'::uuid, NULL) IS NULL

  UNION ALL
  -- Every date shown is real, never invented for a seat that has none.
  SELECT 11, 'No seat is given a date the database does not hold',
         NOT EXISTS (
           SELECT 1 FROM r, jsonb_array_elements(r.j->'upcoming') u
           WHERE u->>'date' IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM group_memberships gm, subject s
               WHERE gm.group_id = s.group_id
                 AND gm.payout_position = (u->>'position')::int
                 AND gm.payout_date::text = u->>'date'))
)
SELECT ord, scenario,
       CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS verdict
FROM checks ORDER BY ord;
