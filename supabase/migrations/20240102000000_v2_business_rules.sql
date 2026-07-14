-- ============================================================
-- V2 — Full Business Rules Update
-- Admin controls cashout amount, deadline, penalties
-- Members can join multiple groups
-- Late payment flagging at 6pm
-- ============================================================

-- Add flexible business controls to susu_groups
ALTER TABLE susu_groups
  ADD COLUMN IF NOT EXISTS cashout_amount        DECIMAL(10,2),           -- admin-set payout per member
  ADD COLUMN IF NOT EXISTS payment_deadline      TIME DEFAULT '18:00:00', -- 6pm cut-off
  ADD COLUMN IF NOT EXISTS penalty_per_late_day  DECIMAL(10,2) DEFAULT 0, -- GHS penalty per late day
  ADD COLUMN IF NOT EXISTS reg_fee_to_cashout    BOOLEAN DEFAULT true,    -- add reg fee to member's cashout
  ADD COLUMN IF NOT EXISTS admin_notes           TEXT;                    -- internal notes (not shown to members)

-- Add late-payment tracking to contributions
ALTER TABLE contributions
  ADD COLUMN IF NOT EXISTS is_late       BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_flagged    BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS flagged_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS penalty_due   DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS penalty_paid  DECIMAL(10,2) DEFAULT 0;

-- Penalty ledger
CREATE TABLE IF NOT EXISTS payment_penalties (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id       UUID NOT NULL REFERENCES members(id),
  group_id        UUID NOT NULL REFERENCES susu_groups(id),
  contribution_id UUID REFERENCES contributions(id),
  amount          DECIMAL(10,2) NOT NULL,
  reason          TEXT,
  is_paid         BOOLEAN DEFAULT false,
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_penalties_member ON payment_penalties(member_id);
CREATE INDEX IF NOT EXISTS idx_penalties_group  ON payment_penalties(group_id);
ALTER TABLE payment_penalties ENABLE ROW LEVEL SECURITY;

-- Member → Admin contact messages
CREATE TABLE IF NOT EXISTS contact_messages (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id  UUID NOT NULL REFERENCES members(id),
  subject    TEXT NOT NULL,
  message    TEXT NOT NULL,
  is_read    BOOLEAN DEFAULT false,
  reply_text TEXT,
  replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contact_member ON contact_messages(member_id);
ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- UPDATED activate_group — uses admin-set cashout_amount
-- ============================================================
CREATE OR REPLACE FUNCTION activate_group(p_group_id UUID, p_start_date DATE)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_group         susu_groups%ROWTYPE;
  v_mem           group_memberships%ROWTYPE;
  v_cashout       DECIMAL(10,2);
  v_total_days    INTEGER;
BEGIN
  SELECT * INTO v_group FROM susu_groups WHERE id = p_group_id;
  IF v_group.id IS NULL THEN RAISE EXCEPTION 'Group not found'; END IF;

  -- Use admin-set cashout if provided, otherwise fall back to formula
  v_cashout    := COALESCE(v_group.cashout_amount,
                   v_group.contribution_amount * v_group.max_members * v_group.cycle_days);
  v_total_days := v_group.max_members * v_group.cycle_days;

  -- Update group
  UPDATE susu_groups
  SET start_date = p_start_date,
      end_date   = p_start_date + v_total_days,
      status     = 'active'
  WHERE id = p_group_id;

  -- Delete any existing schedule (safe re-run)
  DELETE FROM contributions WHERE group_id = p_group_id AND status = 'pending';
  DELETE FROM payouts       WHERE group_id = p_group_id AND status = 'upcoming';

  FOR v_mem IN
    SELECT * FROM group_memberships
    WHERE group_id = p_group_id AND status = 'active'
    ORDER BY payout_position
  LOOP
    -- Set payout date and cashout amount on membership
    UPDATE group_memberships
    SET payout_date   = p_start_date + (v_mem.payout_position * v_group.cycle_days),
        payout_amount = v_cashout
    WHERE id = v_mem.id;

    -- Create payout record
    INSERT INTO payouts (member_id, group_id, membership_id, total_amount, scheduled_date, status)
    VALUES (
      v_mem.member_id, p_group_id, v_mem.id, v_cashout,
      p_start_date + (v_mem.payout_position * v_group.cycle_days),
      'upcoming'
    );

    -- Generate daily contribution rows for the full group duration
    FOR i IN 0..(v_total_days - 1) LOOP
      INSERT INTO contributions (
        member_id, group_id, membership_id, amount,
        due_date, status, cycle_number
      ) VALUES (
        v_mem.member_id, p_group_id, v_mem.id,
        v_group.contribution_amount,
        p_start_date + i,
        'pending',
        FLOOR(i::FLOAT / v_group.cycle_days) + 1
      );
    END LOOP;
  END LOOP;
END;
$$;

-- ============================================================
-- FLAG LATE CONTRIBUTIONS — call after 6pm daily
-- ============================================================
CREATE OR REPLACE FUNCTION flag_late_contributions()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE updated_count INTEGER;
BEGIN
  UPDATE contributions c
  SET is_late    = true,
      is_flagged = true,
      flagged_at = NOW(),
      status     = 'overdue'
  FROM susu_groups g
  WHERE c.group_id = g.id
    AND c.status   = 'pending'
    AND c.due_date <= CURRENT_DATE
    AND CURRENT_TIME > g.payment_deadline;

  GET DIAGNOSTICS updated_count = ROW_COUNT;

  -- Create penalty records for newly flagged contributions
  INSERT INTO payment_penalties (member_id, group_id, contribution_id, amount, reason)
  SELECT c.member_id, c.group_id, c.id, g.penalty_per_late_day,
         'Late payment – ' || c.due_date::TEXT
  FROM contributions c
  JOIN susu_groups g ON g.id = c.group_id
  WHERE c.is_flagged    = true
    AND c.flagged_at::DATE = CURRENT_DATE
    AND g.penalty_per_late_day > 0
    AND NOT EXISTS (
      SELECT 1 FROM payment_penalties p WHERE p.contribution_id = c.id
    );

  -- Sync penalty_due onto contributions
  UPDATE contributions c
  SET penalty_due = g.penalty_per_late_day
  FROM susu_groups g
  WHERE c.group_id = g.id
    AND c.is_flagged   = true
    AND c.penalty_due  = 0
    AND g.penalty_per_late_day > 0;

  RETURN updated_count;
END;
$$;

-- ============================================================
-- MEMBER BALANCE SUMMARY per group
-- ============================================================
CREATE OR REPLACE FUNCTION get_member_plan_balance(p_member_id UUID, p_group_id UUID)
RETURNS TABLE (
  total_paid     DECIMAL,
  total_remaining DECIMAL,
  total_overdue  DECIMAL,
  penalty_balance DECIMAL,
  contributions_paid    INTEGER,
  contributions_total   INTEGER
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE WHEN c.status = 'paid'    THEN c.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN c.status IN ('pending','overdue') THEN c.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN c.status = 'overdue' THEN c.amount ELSE 0 END), 0),
    COALESCE((SELECT SUM(p.amount) FROM payment_penalties p
              WHERE p.member_id = p_member_id AND p.group_id = p_group_id AND NOT p.is_paid), 0),
    COUNT(CASE WHEN c.status = 'paid' THEN 1 END)::INTEGER,
    COUNT(*)::INTEGER
  FROM contributions c
  WHERE c.member_id = p_member_id AND c.group_id = p_group_id;
END;
$$;

-- ============================================================
-- MARK OVERDUE — catch any missed past-due contributions
-- ============================================================
CREATE OR REPLACE FUNCTION mark_overdue_contributions()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE updated_count INTEGER;
BEGIN
  UPDATE contributions
  SET status = 'overdue'
  WHERE status = 'pending' AND due_date < CURRENT_DATE;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$;
