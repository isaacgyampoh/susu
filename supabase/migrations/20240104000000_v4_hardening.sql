-- ============================================================
-- V4 — Security & integrity hardening
-- ============================================================

-- ── 1. Guard activate_group against re-runs on a live group ──
-- p_force is a new parameter with a DEFAULT, which OVERLOADS the two-argument
-- version rather than replacing it. Both would then match a two-argument call
-- and Postgres would raise "function is not unique" — at runtime, when an admin
-- clicks Activate, not here. Drop the old signature.
DROP FUNCTION IF EXISTS activate_group(UUID, DATE);
-- Previously a second Activate click deleted every pending contribution and
-- upcoming payout, then rebuilt the schedule from a new start date — silently
-- shifting everyone's collection day. Now it refuses unless explicitly forced.
CREATE OR REPLACE FUNCTION activate_group(
  p_group_id   UUID,
  p_start_date DATE,
  p_force      BOOLEAN DEFAULT false
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_group   susu_groups%ROWTYPE;
  v_mem     group_memberships%ROWTYPE;
  v_cashout DECIMAL(10,2);
  v_total_days INTEGER;
  v_paid_count INTEGER;
BEGIN
  SELECT * INTO v_group FROM susu_groups WHERE id = p_group_id;
  IF v_group.id IS NULL THEN RAISE EXCEPTION 'Group not found'; END IF;

  IF v_group.status = 'completed' THEN
    RAISE EXCEPTION 'This group has completed and cannot be re-activated';
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
      -- Don't recreate a day the member has already paid for
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

-- ── 2. Brute-force protection on the 6-digit member passcode ──
-- A 6-digit PIN is only a million combinations. Unlimited attempts is not a
-- passcode, it's a countdown.
CREATE TABLE IF NOT EXISTS login_attempts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  identifier  TEXT NOT NULL,          -- phone or email
  kind        TEXT NOT NULL,          -- 'member' | 'admin'
  succeeded   BOOLEAN DEFAULT false,
  attempted_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_attempts_lookup ON login_attempts(identifier, attempted_at DESC);
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION check_login_allowed(p_identifier TEXT, p_kind TEXT)
RETURNS TABLE (allowed BOOLEAN, retry_after_seconds INTEGER)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_fails INTEGER;
  v_last  TIMESTAMPTZ;
BEGIN
  SELECT COUNT(*), MAX(attempted_at) INTO v_fails, v_last
  FROM login_attempts
  WHERE identifier = p_identifier AND kind = p_kind
    AND NOT succeeded AND attempted_at > NOW() - INTERVAL '15 minutes';

  IF v_fails >= 5 THEN
    RETURN QUERY SELECT false,
      GREATEST(0, EXTRACT(EPOCH FROM (v_last + INTERVAL '15 minutes' - NOW()))::INTEGER);
  ELSE
    RETURN QUERY SELECT true, 0;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION record_login_attempt(p_identifier TEXT, p_kind TEXT, p_ok BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO login_attempts (identifier, kind, succeeded) VALUES (p_identifier, p_kind, p_ok);
  -- On success, clear the slate
  IF p_ok THEN
    DELETE FROM login_attempts
    WHERE identifier = p_identifier AND kind = p_kind AND NOT succeeded;
  END IF;
  -- Housekeeping
  DELETE FROM login_attempts WHERE attempted_at < NOW() - INTERVAL '24 hours';
END;
$$;

-- ── 3. Stop double-paying a contribution ──
-- Two tabs, or a webhook racing a verify call, could both settle the same row.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_contribution_ref
  ON contributions(paystack_ref) WHERE paystack_ref IS NOT NULL;

-- ── 4. A member can only hold one slot per group ──
-- (belt and braces: the UNIQUE constraint exists, but make the intent explicit)
CREATE INDEX IF NOT EXISTS idx_membership_lookup ON group_memberships(group_id, status);
