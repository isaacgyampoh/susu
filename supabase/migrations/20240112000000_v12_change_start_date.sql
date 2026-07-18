-- ============================================================
-- V12 — CORRECT AN ACTIVE GROUP'S START DATE
-- ============================================================
-- Activating a group with the wrong date shouldn't be a one-way door.
-- A rebuild (p_force) re-generates the pending schedule from the new
-- date, but whether payout dates are recomputed is now an explicit
-- choice instead of a side effect:
--
--   p_recompute_payouts = true   → payout dates/amounts recomputed from
--                                  the new start date and positions
--   p_recompute_payouts = false  → every member keeps their current
--                                  payout date/amount (only the daily
--                                  schedule shifts)
--   p_recompute_payouts = NULL   → old behaviour: recompute when forced,
--                                  preserve on first activation
--
-- Paid contributions are never touched; only pending/overdue days are
-- rebuilt. Members who already received their payout never get a new
-- upcoming one.

DROP FUNCTION IF EXISTS activate_group(UUID, DATE, BOOLEAN, BOOLEAN);

CREATE OR REPLACE FUNCTION activate_group(
  p_group_id          UUID,
  p_start_date        DATE,
  p_force             BOOLEAN DEFAULT false,
  p_allow_past        BOOLEAN DEFAULT false,
  p_recompute_payouts BOOLEAN DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
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
BEGIN
  SELECT * INTO v_group FROM susu_groups WHERE id = p_group_id;
  IF v_group.id IS NULL THEN RAISE EXCEPTION 'Group not found'; END IF;

  IF v_group.status = 'completed' THEN
    RAISE EXCEPTION 'This group has completed and cannot be re-activated';
  END IF;

  IF p_start_date < CURRENT_DATE AND NOT p_allow_past THEN
    RAISE EXCEPTION 'Start date is in the past. Tick the confirmation to backdate a group that genuinely started on %.', p_start_date;
  END IF;

  -- Refuse to rebuild a schedule that members have already paid into,
  -- unless the admin explicitly forces it (date correction is a forced rebuild)
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
  SET start_date = p_start_date,
      end_date   = v_end_date,
      status     = 'active'
  WHERE id = p_group_id;

  DELETE FROM contributions WHERE group_id = p_group_id AND status IN ('pending','overdue');
  DELETE FROM payouts       WHERE group_id = p_group_id AND status = 'upcoming';

  FOR v_mem IN
    SELECT * FROM group_memberships
    WHERE group_id = p_group_id AND status = 'active'
    ORDER BY payout_position
  LOOP
    -- A member owes nothing from before the day they joined
    v_mem_start := GREATEST(p_start_date, COALESCE(v_mem.joined_at::DATE, p_start_date));

    IF v_recompute THEN
      v_payout_date := p_start_date + (v_mem.payout_position * v_group.cycle_days);
      v_payout_amt  := v_cashout;
    ELSE
      v_payout_date := COALESCE(v_mem.payout_date,
                         p_start_date + (v_mem.payout_position * v_group.cycle_days));
      v_payout_amt  := COALESCE(v_mem.payout_amount, v_cashout);
    END IF;

    UPDATE group_memberships
    SET payout_date   = v_payout_date,
        payout_amount = v_payout_amt
    WHERE id = v_mem.id;

    IF NOT COALESCE(v_mem.payout_received, false) THEN
      INSERT INTO payouts (member_id, group_id, membership_id, total_amount, scheduled_date, status)
      VALUES (v_mem.member_id, p_group_id, v_mem.id, v_payout_amt, v_payout_date, 'upcoming');
    END IF;

    v_offset := v_mem_start - p_start_date;
    FOR i IN v_offset..(v_total_days - 1) LOOP
      IF NOT EXISTS (
        SELECT 1 FROM contributions
        WHERE membership_id = v_mem.id AND due_date = p_start_date + i
      ) THEN
        INSERT INTO contributions (member_id, group_id, membership_id, amount, due_date, status, cycle_number)
        VALUES (v_mem.member_id, p_group_id, v_mem.id, v_group.contribution_amount,
                p_start_date + i, 'pending', FLOOR(i::FLOAT / v_group.cycle_days) + 1);
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
