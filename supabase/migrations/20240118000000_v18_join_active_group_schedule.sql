-- ============================================================
-- V18 — NEW JOINERS IN A RUNNING GROUP GET A SCHEDULE
-- ============================================================
-- Activation generates schedules for the members present at that moment.
-- Anyone who joins AFTER activation had no contribution rows at all —
-- nothing to pay, nothing to record. This function fills a single
-- membership's pending schedule from the day they joined to the group's
-- end, skipping any rows that already exist (safe to call repeatedly).
-- It quietly does nothing for groups that aren't active yet.

CREATE OR REPLACE FUNCTION generate_membership_schedule(p_membership_id UUID)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_mem        group_memberships%ROWTYPE;
  v_group      susu_groups%ROWTYPE;
  v_frac       NUMERIC := 1;
  v_total_days INTEGER;
  v_mem_start  DATE;
  v_offset     INTEGER;
  v_inserted   INTEGER := 0;
BEGIN
  SELECT * INTO v_mem FROM group_memberships WHERE id = p_membership_id;
  IF v_mem.id IS NULL THEN RETURN 0; END IF;

  SELECT * INTO v_group FROM susu_groups WHERE id = v_mem.group_id;
  IF v_group.status <> 'active' OR v_group.start_date IS NULL THEN RETURN 0; END IF;

  -- slot_fraction arrived in v15; read it tolerantly so this works either way
  v_frac := COALESCE((to_jsonb(v_mem)->>'slot_fraction')::NUMERIC, 1);

  v_total_days := v_group.max_members * v_group.cycle_days;
  v_mem_start  := GREATEST(v_group.start_date, COALESCE(v_mem.joined_at::DATE, v_group.start_date));
  v_offset     := v_mem_start - v_group.start_date;
  IF v_offset < 0 THEN v_offset := 0; END IF;

  FOR i IN v_offset..(v_total_days - 1) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM contributions
      WHERE membership_id = p_membership_id AND due_date = v_group.start_date + i
    ) THEN
      INSERT INTO contributions (member_id, group_id, membership_id, amount, due_date, status, cycle_number)
      VALUES (v_mem.member_id, v_mem.group_id, p_membership_id,
              ROUND(v_group.contribution_amount * v_frac, 2),
              v_group.start_date + i, 'pending',
              FLOOR(i::FLOAT / v_group.cycle_days) + 1);
      v_inserted := v_inserted + 1;
    END IF;
  END LOOP;

  RETURN v_inserted;
END;
$$;
