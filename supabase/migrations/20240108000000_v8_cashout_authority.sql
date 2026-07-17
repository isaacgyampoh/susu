-- ============================================================
-- 09 — The admin's cashout is the only cashout
-- ============================================================
-- activate_group fell back to contribution x members x cycle_days when
-- cashout_amount was not set, and wrote that invented figure into
-- payout_amount — the number a member is actually paid. A payout must never be
-- a number the system made up. If the admin has not decided it, activation
-- stops and says so.

DROP FUNCTION IF EXISTS activate_group(UUID, DATE, BOOLEAN);
DROP FUNCTION IF EXISTS activate_group(UUID, DATE);

CREATE FUNCTION activate_group(
  p_group_id   UUID,
  p_start_date DATE,
  p_force      BOOLEAN DEFAULT false
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_group      susu_groups%ROWTYPE;
  v_mem        group_memberships%ROWTYPE;
  v_cashout    DECIMAL(10,2);
  v_total_days INTEGER;
  v_paid_count INTEGER;
BEGIN
  SELECT * INTO v_group FROM susu_groups WHERE id = p_group_id;
  IF v_group.id IS NULL THEN RAISE EXCEPTION 'Group not found'; END IF;

  -- The admin's figure, or nothing. No formula.
  IF v_group.cashout_amount IS NULL OR v_group.cashout_amount <= 0 THEN
    RAISE EXCEPTION 'Set the member cashout amount before activating. It is what members are paid and it is not calculated.';
  END IF;
  v_cashout := v_group.cashout_amount;

  IF v_group.status = 'completed' THEN
    RAISE EXCEPTION 'This group has completed and cannot be re-activated';
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

  v_total_days := v_group.max_members * v_group.cycle_days;

  UPDATE susu_groups
  SET start_date = p_start_date,
      end_date   = p_start_date + v_total_days,
      status     = 'active'
  WHERE id = p_group_id;

  DELETE FROM contributions WHERE group_id = p_group_id AND status IN ('pending','overdue');
  DELETE FROM payouts       WHERE group_id = p_group_id AND status = 'upcoming';

  FOR v_mem IN
    SELECT * FROM group_memberships
    WHERE group_id = p_group_id AND status = 'active'
    ORDER BY payout_position
  LOOP
    UPDATE group_memberships
    SET payout_date   = p_start_date + (v_mem.payout_position * v_group.cycle_days),
        payout_amount = v_cashout
    WHERE id = v_mem.id;

    INSERT INTO payouts (member_id, group_id, membership_id, total_amount, scheduled_date, status)
    VALUES (v_mem.member_id, p_group_id, v_mem.id, v_cashout,
            p_start_date + (v_mem.payout_position * v_group.cycle_days), 'upcoming');

    FOR i IN 0..(v_total_days - 1) LOOP
      IF NOT EXISTS (
        SELECT 1 FROM contributions WHERE membership_id = v_mem.id AND due_date = p_start_date + i
      ) THEN
        INSERT INTO contributions (member_id, group_id, membership_id, amount, due_date, status, cycle_number)
        VALUES (v_mem.member_id, p_group_id, v_mem.id, v_group.contribution_amount,
                p_start_date + i, 'pending', FLOOR(i::FLOAT / v_group.cycle_days) + 1);
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

-- A group cannot be advertised without a decided payout
CREATE OR REPLACE FUNCTION fn_require_cashout_when_open()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('open','full','active')
     AND (NEW.cashout_amount IS NULL OR NEW.cashout_amount <= 0) THEN
    RAISE EXCEPTION 'Set the member cashout amount before opening this group to members.';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_require_cashout ON susu_groups;
CREATE TRIGGER trg_require_cashout
  BEFORE INSERT OR UPDATE OF status, cashout_amount ON susu_groups
  FOR EACH ROW EXECUTE FUNCTION fn_require_cashout_when_open();
