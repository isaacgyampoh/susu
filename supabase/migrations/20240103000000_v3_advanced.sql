-- ============================================================
-- V3 — ADVANCED FEATURES
-- Bulk payments · Payout eligibility · Defaulter handling
-- Audit log · Financial reconciliation
-- ============================================================

-- ── AUDIT LOG ──
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id    UUID REFERENCES admin_users(id),
  admin_name  TEXT,
  action      TEXT NOT NULL,           -- e.g. 'payout.marked_paid'
  entity_type TEXT,                    -- 'member' | 'group' | 'payout' | 'contribution'
  entity_id   UUID,
  entity_label TEXT,                   -- human readable, e.g. 'SSU-0042 — Kofi Mensah'
  details     JSONB,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_admin   ON audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_entity  ON audit_log(entity_type, entity_id);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- ── MEMBERSHIP: defaulter / forfeiture tracking ──
ALTER TABLE group_memberships
  ADD COLUMN IF NOT EXISTS forfeited_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS forfeit_reason   TEXT,
  ADD COLUMN IF NOT EXISTS replaced_by      UUID REFERENCES members(id);

-- ── PAYOUTS: eligibility snapshot ──
ALTER TABLE payouts
  ADD COLUMN IF NOT EXISTS eligibility_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS outstanding_at_payout  DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deductions             DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_amount             DECIMAL(10,2);

-- ── TRANSACTIONS: link bulk payments together ──
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS batch_id      UUID,
  ADD COLUMN IF NOT EXISTS items_count   INTEGER DEFAULT 1;

ALTER TABLE contributions
  ADD COLUMN IF NOT EXISTS batch_id      UUID;

-- ============================================================
-- PAYOUT ELIGIBILITY — can this member be paid out?
-- ============================================================
CREATE OR REPLACE FUNCTION check_payout_eligibility(p_payout_id UUID)
RETURNS TABLE (
  eligible            BOOLEAN,
  reason              TEXT,
  gross_amount        DECIMAL,
  outstanding_contrib DECIMAL,
  outstanding_penalty DECIMAL,
  registration_fee    DECIMAL,
  net_amount          DECIMAL,
  contributions_paid  INTEGER,
  contributions_due   INTEGER
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_payout   payouts%ROWTYPE;
  v_group    susu_groups%ROWTYPE;
  v_out_c    DECIMAL := 0;
  v_out_p    DECIMAL := 0;
  v_paid     INTEGER := 0;
  v_due      INTEGER := 0;
  v_regfee   DECIMAL := 0;
  v_net      DECIMAL := 0;
  v_eligible BOOLEAN := true;
  v_reason   TEXT := 'Member is eligible for payout';
BEGIN
  SELECT * INTO v_payout FROM payouts WHERE id = p_payout_id;
  IF v_payout.id IS NULL THEN
    RETURN QUERY SELECT false, 'Payout not found'::TEXT, 0::DECIMAL, 0::DECIMAL, 0::DECIMAL, 0::DECIMAL, 0::DECIMAL, 0, 0;
    RETURN;
  END IF;

  SELECT * INTO v_group FROM susu_groups WHERE id = v_payout.group_id;

  -- Contributions owed UP TO the payout date (not the whole cycle)
  SELECT
    COALESCE(SUM(CASE WHEN status IN ('pending','overdue') THEN amount ELSE 0 END), 0),
    COUNT(CASE WHEN status = 'paid' THEN 1 END),
    COUNT(*)
  INTO v_out_c, v_paid, v_due
  FROM contributions
  WHERE member_id = v_payout.member_id
    AND group_id  = v_payout.group_id
    AND due_date <= v_payout.scheduled_date;

  -- Unpaid penalties
  SELECT COALESCE(SUM(amount), 0) INTO v_out_p
  FROM payment_penalties
  WHERE member_id = v_payout.member_id
    AND group_id  = v_payout.group_id
    AND NOT is_paid;

  -- Registration fee added back to cashout?
  IF COALESCE(v_group.reg_fee_to_cashout, true) THEN
    v_regfee := COALESCE(v_group.registration_fee, 0);
  END IF;

  -- Net = gross + reg fee - outstanding contributions - penalties
  v_net := v_payout.total_amount + v_regfee - v_out_c - v_out_p;

  IF v_out_c > 0 THEN
    v_eligible := false;
    v_reason := 'Member has GHS ' || v_out_c::TEXT || ' in unpaid contributions due before payout date';
  ELSIF v_out_p > 0 THEN
    v_eligible := true;  -- can still pay, but deduct penalties
    v_reason := 'Eligible — GHS ' || v_out_p::TEXT || ' in penalties will be deducted';
  END IF;

  RETURN QUERY SELECT v_eligible, v_reason, v_payout.total_amount, v_out_c, v_out_p, v_regfee, v_net, v_paid, v_due;
END;
$$;

-- ============================================================
-- GROUP FINANCIAL HEALTH — does the pot balance?
-- ============================================================
CREATE OR REPLACE FUNCTION get_group_financials(p_group_id UUID)
RETURNS TABLE (
  expected_total    DECIMAL,   -- what SHOULD be collected across whole cycle
  collected_total   DECIMAL,   -- what HAS been collected
  outstanding_total DECIMAL,   -- what's still owed
  overdue_total     DECIMAL,   -- what's late
  penalties_total   DECIMAL,
  reg_fees_total    DECIMAL,
  paid_out_total    DECIMAL,   -- payouts already made
  pending_payouts   DECIMAL,   -- payouts still owed
  balance           DECIMAL,   -- collected + regfees - paid_out
  collection_rate   DECIMAL,   -- % of due contributions actually paid
  member_count      INTEGER,
  active_members    INTEGER,
  defaulted_members INTEGER
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_expected DECIMAL := 0; v_collected DECIMAL := 0;
  v_outstanding DECIMAL := 0; v_overdue DECIMAL := 0;
  v_penalties DECIMAL := 0; v_regfees DECIMAL := 0;
  v_paidout DECIMAL := 0; v_pendingout DECIMAL := 0;
  v_due_todate DECIMAL := 0;
  v_mc INTEGER := 0; v_ac INTEGER := 0; v_dc INTEGER := 0;
BEGIN
  SELECT
    COALESCE(SUM(amount), 0),
    COALESCE(SUM(CASE WHEN status = 'paid'    THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN status IN ('pending','overdue') THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN status = 'overdue' THEN amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN due_date <= CURRENT_DATE THEN amount ELSE 0 END), 0)
  INTO v_expected, v_collected, v_outstanding, v_overdue, v_due_todate
  FROM contributions WHERE group_id = p_group_id;

  SELECT COALESCE(SUM(amount), 0) INTO v_penalties
  FROM payment_penalties WHERE group_id = p_group_id AND NOT is_paid;

  SELECT COALESCE(SUM(t.amount), 0) INTO v_regfees
  FROM transactions t
  WHERE t.type = 'registration_fee' AND t.status = 'success'
    AND t.member_id IN (SELECT member_id FROM group_memberships WHERE group_id = p_group_id);

  SELECT
    COALESCE(SUM(CASE WHEN status = 'paid'     THEN total_amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN status != 'paid'    THEN total_amount ELSE 0 END), 0)
  INTO v_paidout, v_pendingout
  FROM payouts WHERE group_id = p_group_id;

  SELECT
    COUNT(*),
    COUNT(CASE WHEN status = 'active'    THEN 1 END),
    COUNT(CASE WHEN status = 'defaulted' THEN 1 END)
  INTO v_mc, v_ac, v_dc
  FROM group_memberships WHERE group_id = p_group_id;

  RETURN QUERY SELECT
    v_expected, v_collected, v_outstanding, v_overdue,
    v_penalties, v_regfees, v_paidout, v_pendingout,
    (v_collected + v_regfees - v_paidout),
    CASE WHEN v_due_todate > 0 THEN ROUND((v_collected / v_due_todate) * 100, 1) ELSE 0 END,
    v_mc, v_ac, v_dc;
END;
$$;

-- ============================================================
-- FORFEIT A MEMBER'S SLOT (defaulter handling)
-- ============================================================
CREATE OR REPLACE FUNCTION forfeit_membership(
  p_membership_id UUID,
  p_reason TEXT,
  p_admin_id UUID
) RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_m group_memberships%ROWTYPE;
BEGIN
  SELECT * INTO v_m FROM group_memberships WHERE id = p_membership_id;
  IF v_m.id IS NULL THEN RAISE EXCEPTION 'Membership not found'; END IF;
  IF v_m.payout_received THEN RAISE EXCEPTION 'Cannot forfeit — member has already received their payout'; END IF;

  UPDATE group_memberships
  SET status = 'defaulted', forfeited_at = NOW(), forfeit_reason = p_reason
  WHERE id = p_membership_id;

  -- Cancel their future contributions
  DELETE FROM contributions
  WHERE membership_id = p_membership_id AND status IN ('pending','overdue');

  -- Cancel their upcoming payout
  DELETE FROM payouts
  WHERE membership_id = p_membership_id AND status = 'upcoming';

  -- Suspend the member account
  UPDATE members SET status = 'suspended' WHERE id = v_m.member_id;
END;
$$;

-- ============================================================
-- MEMBER STATEMENT — full ledger for one member
-- ============================================================
CREATE OR REPLACE FUNCTION get_member_statement(p_member_id UUID)
RETURNS TABLE (
  entry_date  DATE,
  entry_type  TEXT,
  description TEXT,
  debit       DECIMAL,
  credit      DECIMAL,
  status      TEXT,
  reference   TEXT
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  -- Contributions (money in)
  SELECT
    c.due_date,
    'contribution'::TEXT,
    ('Contribution — ' || g.name)::TEXT,
    0::DECIMAL,
    CASE WHEN c.status = 'paid' THEN c.amount ELSE 0 END,
    c.status::TEXT,
    COALESCE(c.paystack_ref, '')::TEXT
  FROM contributions c
  JOIN susu_groups g ON g.id = c.group_id
  WHERE c.member_id = p_member_id

  UNION ALL
  -- Payouts (money out)
  SELECT
    p.scheduled_date,
    'payout'::TEXT,
    ('Cashout — ' || g.name)::TEXT,
    p.total_amount,
    0::DECIMAL,
    p.status::TEXT,
    COALESCE(p.paystack_transfer_ref, '')::TEXT
  FROM payouts p
  JOIN susu_groups g ON g.id = p.group_id
  WHERE p.member_id = p_member_id

  UNION ALL
  -- Penalties
  SELECT
    pp.created_at::DATE,
    'penalty'::TEXT,
    pp.reason::TEXT,
    pp.amount,
    0::DECIMAL,
    CASE WHEN pp.is_paid THEN 'paid' ELSE 'outstanding' END::TEXT,
    ''::TEXT
  FROM payment_penalties pp
  WHERE pp.member_id = p_member_id

  ORDER BY 1 DESC;
END;
$$;

-- ============================================================
-- PLATFORM-WIDE ANALYTICS
-- ============================================================
CREATE OR REPLACE FUNCTION get_platform_analytics()
RETURNS TABLE (
  collected_today     DECIMAL,
  collected_this_week  DECIMAL,
  collected_this_month DECIMAL,
  due_today           DECIMAL,
  paid_today_count    INTEGER,
  due_today_count     INTEGER,
  collection_rate_today DECIMAL,
  total_outstanding   DECIMAL,
  total_overdue       DECIMAL,
  active_members      INTEGER,
  defaulted_members   INTEGER,
  payouts_due_7d      DECIMAL,
  payouts_due_30d     DECIMAL
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_due_today_amt DECIMAL := 0;
  v_paid_today_amt DECIMAL := 0;
  v_dtc INTEGER := 0; v_ptc INTEGER := 0;
BEGIN
  SELECT
    COALESCE(SUM(amount), 0),
    COUNT(*),
    COALESCE(SUM(CASE WHEN status='paid' THEN amount ELSE 0 END), 0),
    COUNT(CASE WHEN status='paid' THEN 1 END)
  INTO v_due_today_amt, v_dtc, v_paid_today_amt, v_ptc
  FROM contributions WHERE due_date = CURRENT_DATE;

  RETURN QUERY SELECT
    v_paid_today_amt,
    (SELECT COALESCE(SUM(amount),0) FROM contributions
      WHERE status='paid' AND paid_at >= date_trunc('week', CURRENT_DATE)),
    (SELECT COALESCE(SUM(amount),0) FROM contributions
      WHERE status='paid' AND paid_at >= date_trunc('month', CURRENT_DATE)),
    v_due_today_amt,
    v_ptc,
    v_dtc,
    CASE WHEN v_due_today_amt > 0 THEN ROUND((v_paid_today_amt / v_due_today_amt)*100, 1) ELSE 0 END,
    (SELECT COALESCE(SUM(amount),0) FROM contributions WHERE status IN ('pending','overdue')),
    (SELECT COALESCE(SUM(amount),0) FROM contributions WHERE status = 'overdue'),
    (SELECT COUNT(*)::INTEGER FROM members WHERE status='active'),
    (SELECT COUNT(*)::INTEGER FROM group_memberships WHERE status='defaulted'),
    (SELECT COALESCE(SUM(total_amount),0) FROM payouts
      WHERE status='upcoming' AND scheduled_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7),
    (SELECT COALESCE(SUM(total_amount),0) FROM payouts
      WHERE status='upcoming' AND scheduled_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30);
END;
$$;

-- ============================================================
-- DAILY COLLECTION TREND (for charts)
-- ============================================================
CREATE OR REPLACE FUNCTION get_collection_trend(p_days INTEGER DEFAULT 14)
RETURNS TABLE (day DATE, expected DECIMAL, collected DECIMAL, rate DECIMAL)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    d::DATE,
    COALESCE(SUM(c.amount), 0),
    COALESCE(SUM(CASE WHEN c.status='paid' THEN c.amount ELSE 0 END), 0),
    CASE WHEN COALESCE(SUM(c.amount),0) > 0
      THEN ROUND((COALESCE(SUM(CASE WHEN c.status='paid' THEN c.amount ELSE 0 END),0) / SUM(c.amount))*100, 1)
      ELSE 0 END
  FROM generate_series(CURRENT_DATE - (p_days - 1), CURRENT_DATE, '1 day'::interval) d
  LEFT JOIN contributions c ON c.due_date = d::DATE
  GROUP BY d ORDER BY d;
END;
$$;
