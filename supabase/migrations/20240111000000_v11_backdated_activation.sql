-- ============================================================
-- V11 — ACTIVATE LEGACY GROUPS WITH A REAL (PAST) START DATE
-- ============================================================
-- Some groups were running long before this system existed. Activating
-- them must accept the date they ACTUALLY started so the maths comes out
-- right, without wrecking history recorded via member onboarding:
--
--   1. p_allow_past permits a start date before today (deliberate opt-in).
--   2. Each member's daily schedule begins at GREATEST(group start, the
--      day THEY joined) — nobody owes days from before they were a member.
--   3. Payout dates/amounts already set on a membership (during onboarding
--      or by admin edit) are PRESERVED on first activation; only a forced
--      rebuild recomputes them from positions.
--   4. Days already recorded as paid (onboarded history) are never
--      recreated; unpaid past days are generated as pending and will be
--      flagged as arrears by the usual late-payment job.

DROP FUNCTION IF EXISTS activate_group(UUID, DATE, BOOLEAN);

CREATE OR REPLACE FUNCTION activate_group(
  p_group_id   UUID,
  p_start_date DATE,
  p_force      BOOLEAN DEFAULT false,
  p_allow_past BOOLEAN DEFAULT false
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
BEGIN
  SELECT * INTO v_group FROM susu_groups WHERE id = p_group_id;
  IF v_group.id IS NULL THEN RAISE EXCEPTION 'Group not found'; END IF;

  IF v_group.status = 'completed' THEN
    RAISE EXCEPTION 'This group has completed and cannot be re-activated';
  END IF;

  IF p_start_date < CURRENT_DATE AND NOT p_allow_past THEN
    RAISE EXCEPTION 'Start date is in the past. Tick the confirmation to backdate a group that genuinely started on %.', p_start_date;
  END IF;

  -- Refuse to rebuild a schedule that members have already paid into
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

    -- Preserve payout details the admin already set, unless forcing a rebuild
    IF p_force THEN
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

    -- Someone who already received their payout doesn't get a new upcoming one
    IF NOT COALESCE(v_mem.payout_received, false) THEN
      INSERT INTO payouts (member_id, group_id, membership_id, total_amount, scheduled_date, status)
      VALUES (v_mem.member_id, p_group_id, v_mem.id, v_payout_amt, v_payout_date, 'upcoming');
    END IF;

    v_offset := v_mem_start - p_start_date;
    FOR i IN v_offset..(v_total_days - 1) LOOP
      -- Don't recreate a day the member has already paid for (onboarded history)
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
