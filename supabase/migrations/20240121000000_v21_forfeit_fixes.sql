-- ============================================================
-- V21 — FORFEIT FIXES (multi-slot correctness)
-- ============================================================
-- Two bugs when forfeiting one slot of a member who holds several:
--   1. current_members wasn't decremented (the count trigger only fires on
--      INSERT/DELETE, not a status change), so the group still showed the
--      forfeited slot.
--   2. the member's WHOLE account was suspended, even if they still hold
--      other active slots or belong to other groups.
-- This rewrite decrements the group count and only suspends the account when
-- the member has no remaining active membership anywhere.

CREATE OR REPLACE FUNCTION forfeit_membership(
  p_membership_id UUID,
  p_reason TEXT,
  p_admin_id UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_m group_memberships%ROWTYPE;
  v_remaining INTEGER;
BEGIN
  SELECT * INTO v_m FROM group_memberships WHERE id = p_membership_id;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'Membership not found'; END IF;
  IF v_m.payout_received THEN RAISE EXCEPTION 'Cannot forfeit — member has already received their payout'; END IF;
  IF v_m.status = 'defaulted' THEN RAISE EXCEPTION 'This slot is already forfeited'; END IF;

  UPDATE group_memberships
  SET status = 'defaulted', forfeited_at = NOW(), forfeit_reason = p_reason
  WHERE id = p_membership_id;

  -- Free the slot in the group's live count (and reopen a full group)
  UPDATE susu_groups
  SET current_members = GREATEST(current_members - 1, 0),
      status = CASE WHEN status = 'full' THEN 'open' ELSE status END
  WHERE id = v_m.group_id;

  -- Cancel this slot's future contributions and upcoming payout only
  DELETE FROM contributions
  WHERE membership_id = p_membership_id AND status IN ('pending','overdue');
  DELETE FROM payouts
  WHERE membership_id = p_membership_id AND status = 'upcoming';

  -- Suspend the account ONLY if no active membership remains anywhere
  SELECT COUNT(*) INTO v_remaining
  FROM group_memberships
  WHERE member_id = v_m.member_id AND status = 'active';

  IF v_remaining = 0 THEN
    UPDATE members SET status = 'suspended' WHERE id = v_m.member_id;
  END IF;
END;
$$;

-- One-off repair: resync every group's current_members to the true number of
-- active slots, correcting any counts left wrong by past forfeits.
UPDATE susu_groups g
SET current_members = (
  SELECT COUNT(*) FROM group_memberships gm
  WHERE gm.group_id = g.id AND gm.status = 'active'
);
