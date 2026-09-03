-- ============================================================================
-- v50 — WHAT ONE GROUP IS OWED AND HAS RECEIVED
-- ============================================================================
-- Read-only. Writes nothing.
--
-- Scoped to the memberships of this group alone. A member in four groups has
-- four separate obligations, and pooling them is precisely the mistake the
-- membership model exists to prevent — so every figure here comes from
-- contributions joined through group_memberships of THIS group.
--
-- `settled` follows contribution status via contribution_settled_amount(),
-- not amount_paid. 2,895 historical days are settled with nothing recorded
-- against them; subtracting would report money as outstanding that members
-- paid months ago.
-- ============================================================================
CREATE OR REPLACE FUNCTION get_group_financials_v2(p_group_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'expected',    COALESCE(SUM(c.amount), 0),
    'received',    COALESCE(SUM(contribution_settled_amount(c.status::text, c.amount, c.amount_paid)), 0),
    'outstanding', COALESCE(SUM(c.amount) FILTER (WHERE c.status::text <> 'paid'), 0)
                   - COALESCE(SUM(COALESCE(c.amount_paid,0)) FILTER (WHERE c.status::text <> 'paid'), 0),
    'days_total',  count(*),
    'days_paid',   count(*) FILTER (WHERE c.status::text = 'paid'),
    'days_overdue',count(*) FILTER (WHERE c.status::text = 'overdue'),
    'members',     (SELECT count(DISTINCT gm.member_id) FROM group_memberships gm
                     WHERE gm.group_id = p_group_id AND gm.status = 'active'),
    'slots_taken', (SELECT count(*) FROM group_memberships gm
                     WHERE gm.group_id = p_group_id AND gm.status = 'active'),
    'payouts_paid',(SELECT COALESCE(sum(total_amount),0) FROM payouts
                     WHERE group_id = p_group_id AND status = 'paid')
  )
  FROM contributions c
  WHERE c.group_id = p_group_id;
$$;

REVOKE ALL ON FUNCTION get_group_financials_v2(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_group_financials_v2(uuid) TO service_role;
