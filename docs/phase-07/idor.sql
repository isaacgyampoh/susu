-- ============================================================================
-- §27 — IDOR: can member A reach member B's money?
-- ============================================================================
-- Tested where the scoping actually lives. Read-only; touches nothing.
-- Every row must read PASS.
-- ============================================================================
WITH two AS (
  SELECT member_id,
         row_number() OVER (ORDER BY count(*) DESC) AS rn
  FROM group_memberships WHERE status='active' GROUP BY 1 LIMIT 2
), a AS (SELECT member_id FROM two WHERE rn=1),
   b AS (SELECT member_id FROM two WHERE rn=2),
   bm AS (SELECT id FROM group_memberships WHERE member_id=(SELECT member_id FROM b) AND status='active' LIMIT 1)

SELECT * FROM (
  -- A asks for a statement, naming B's MEMBERSHIP. It must be ignored, not honoured.
  SELECT 'A statement scoped to B''s membership returns none of B''s data' AS check_name,
         (SELECT count(*) FROM jsonb_array_elements(
            get_member_statement((SELECT member_id FROM a), CURRENT_DATE-365, CURRENT_DATE,
                                 (SELECT id FROM bm)) -> 'memberships') ms
          WHERE (ms->>'membership_id')::uuid = (SELECT id FROM bm))::text AS actual,
         '0' AS expected

  UNION ALL
  -- Every membership in A's statement must belong to A.
  SELECT 'every membership in A''s statement belongs to A',
         (SELECT count(*) FROM jsonb_array_elements(
            get_member_statement((SELECT member_id FROM a), CURRENT_DATE-365, CURRENT_DATE, NULL) -> 'memberships') ms
          JOIN group_memberships gm ON gm.id = (ms->>'membership_id')::uuid
          WHERE gm.member_id <> (SELECT member_id FROM a))::text,
         '0'

  UNION ALL
  -- The portal, same question.
  SELECT 'every membership in A''s portal belongs to A',
         (SELECT count(*) FROM jsonb_array_elements(
            get_member_portal_state((SELECT member_id FROM a), CURRENT_DATE) -> 'memberships') ms
          JOIN group_memberships gm ON gm.id = (ms->>'membership_id')::uuid
          WHERE gm.member_id <> (SELECT member_id FROM a))::text,
         '0'

  UNION ALL
  -- A's statement must not carry B's identity.
  SELECT 'A''s statement does not name B',
         (CASE WHEN (get_member_statement((SELECT member_id FROM a), CURRENT_DATE-365, CURRENT_DATE, NULL)
                     -> 'member' ->> 'full_name')
                    = (SELECT full_name FROM members WHERE id=(SELECT member_id FROM b))
               THEN 'LEAK' ELSE 'no' END),
         'no'

  UNION ALL
  -- A payment allocation must never point at a membership of a different member.
  SELECT 'no allocation crosses members',
         (SELECT count(*) FROM payment_allocations pa
           JOIN group_memberships gm ON gm.id = pa.membership_id
          WHERE gm.member_id <> pa.member_id)::text,
         '0'

  UNION ALL
  -- Credit is per-membership and may never cross.
  SELECT 'no credit entry crosses members',
         (SELECT count(*) FROM membership_credit_ledger l
           JOIN group_memberships gm ON gm.id = l.membership_id
          WHERE gm.member_id <> l.member_id)::text,
         '0'

  UNION ALL
  -- A contribution must belong to the membership that owns it.
  SELECT 'no contribution crosses membership',
         (SELECT count(*) FROM contributions c
           JOIN group_memberships gm ON gm.id = c.membership_id
          WHERE gm.member_id <> c.member_id)::text,
         '0'

  UNION ALL
  -- A registration token resolves to exactly one application, or none.
  SELECT 'no two applications share a payment token',
         (SELECT count(*) FROM (
            SELECT payment_token_hash FROM kyc_applications
             WHERE payment_token_hash IS NOT NULL
             GROUP BY 1 HAVING count(*) > 1) x)::text,
         '0'
) t
ORDER BY check_name;
