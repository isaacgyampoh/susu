-- ============================================================
-- V9 — MULTI-GROUP JOINING + EXISTING-MEMBER ONBOARDING
-- ============================================================

-- A KYC applicant may now select more than one group. The old
-- selected_group_id column is kept (first choice) so nothing that
-- reads it breaks; the full selection lives in the array.
ALTER TABLE kyc_applications
  ADD COLUMN IF NOT EXISTS selected_group_ids UUID[];

UPDATE kyc_applications
SET selected_group_ids = ARRAY[selected_group_id]
WHERE selected_group_ids IS NULL AND selected_group_id IS NOT NULL;

-- Memberships created by onboarding existing (pre-system) members are
-- marked so reports can tell backfilled history from live collections.
ALTER TABLE group_memberships
  ADD COLUMN IF NOT EXISTS onboarded_existing BOOLEAN DEFAULT false;

ALTER TABLE contributions
  ADD COLUMN IF NOT EXISTS is_backfilled BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_contributions_backfilled
  ON contributions(is_backfilled) WHERE is_backfilled;
-- ============================================================
-- V10 — MANUAL PAYMENT COLLECTION
-- ============================================================
-- Payments collected by hand (cash in hand, MoMo sent directly,
-- bank transfer) are first-class: we record how each contribution
-- was settled and any reference the admin wants to keep.

ALTER TABLE contributions
  ADD COLUMN IF NOT EXISTS payment_method TEXT,   -- 'cash' | 'momo' | 'bank' | 'paystack' | 'moolre'
  ADD COLUMN IF NOT EXISTS payment_note   TEXT;   -- e.g. MoMo transaction ID, receipt number

CREATE INDEX IF NOT EXISTS idx_contributions_payment_method
  ON contributions(payment_method) WHERE payment_method IS NOT NULL;
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
-- ============================================================
-- V13 — A MEMBER CAN HOLD SEVERAL SLOTS IN ONE GROUP
-- ============================================================
-- One person, one group, three slots = three membership rows, each with
-- its own payout position, its own daily schedule, and its own payout.
-- The one-membership-per-group constraint is therefore dropped;
-- UNIQUE(group_id, payout_position) stays — no two slots share a turn.

ALTER TABLE group_memberships
  DROP CONSTRAINT IF EXISTS group_memberships_member_id_group_id_key;

-- Website applicants choose how many slots they want per group:
-- { "<group_id>": <slots>, ... }
ALTER TABLE kyc_applications
  ADD COLUMN IF NOT EXISTS selected_slots JSONB;
-- ============================================================
-- V14 — PORTAL INVITES ON YOUR SCHEDULE
-- ============================================================
-- Credentials no longer have to go out the moment a member is created.
-- We track when (and whether) each member's portal invite was sent, so
-- everyone can be invited in one batch once the payment system is live.

ALTER TABLE members
  ADD COLUMN IF NOT EXISTS credentials_sent_at TIMESTAMPTZ;
-- ============================================================
-- V15 — QUARTER, HALF AND FULL SLOTS
-- ============================================================
-- A slot no longer has to be whole. A half slot pays half the daily
-- contribution and collects half the cashout on its turn; a quarter slot,
-- a quarter. Every slot — whatever its size — still owns its own payout
-- position in the rotation.

ALTER TABLE group_memberships
  ADD COLUMN IF NOT EXISTS slot_fraction NUMERIC(3,2) NOT NULL DEFAULT 1
  CHECK (slot_fraction IN (0.25, 0.5, 1));

-- The schedule generator must honour fractions: daily amounts and payout
-- amounts scale with slot_fraction.
DROP FUNCTION IF EXISTS activate_group(UUID, DATE, BOOLEAN, BOOLEAN, BOOLEAN);

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
  v_frac         NUMERIC(3,2);
BEGIN
  SELECT * INTO v_group FROM susu_groups WHERE id = p_group_id;
  IF v_group.id IS NULL THEN RAISE EXCEPTION 'Group not found'; END IF;

  IF v_group.status = 'completed' THEN
    RAISE EXCEPTION 'This group has completed and cannot be re-activated';
  END IF;

  IF p_start_date < CURRENT_DATE AND NOT p_allow_past THEN
    RAISE EXCEPTION 'Start date is in the past. Tick the confirmation to backdate a group that genuinely started on %.', p_start_date;
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

  v_cashout    := COALESCE(v_group.cashout_amount,
                    v_group.contribution_amount * v_group.max_members * v_group.cycle_days);
  v_total_days := v_group.max_members * v_group.cycle_days;
  v_end_date   := p_start_date + v_total_days;
  v_recompute  := COALESCE(p_recompute_payouts, p_force);

  UPDATE susu_groups
  SET start_date = p_start_date, end_date = v_end_date, status = 'active'
  WHERE id = p_group_id;

  DELETE FROM contributions WHERE group_id = p_group_id AND status IN ('pending','overdue');
  DELETE FROM payouts       WHERE group_id = p_group_id AND status = 'upcoming';

  FOR v_mem IN
    SELECT * FROM group_memberships
    WHERE group_id = p_group_id AND status = 'active'
    ORDER BY payout_position
  LOOP
    v_mem_start := GREATEST(p_start_date, COALESCE(v_mem.joined_at::DATE, p_start_date));
    v_frac      := COALESCE(v_mem.slot_fraction, 1);

    IF v_recompute THEN
      v_payout_date := p_start_date + (v_mem.payout_position * v_group.cycle_days);
      v_payout_amt  := ROUND(v_cashout * v_frac, 2);
    ELSE
      v_payout_date := COALESCE(v_mem.payout_date,
                         p_start_date + (v_mem.payout_position * v_group.cycle_days));
      v_payout_amt  := COALESCE(v_mem.payout_amount, ROUND(v_cashout * v_frac, 2));
    END IF;

    UPDATE group_memberships
    SET payout_date = v_payout_date, payout_amount = v_payout_amt
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
        VALUES (v_mem.member_id, p_group_id, v_mem.id,
                ROUND(v_group.contribution_amount * v_frac, 2),
                p_start_date + i, 'pending', FLOOR(i::FLOAT / v_group.cycle_days) + 1);
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
-- ============================================================
-- V16 — SHARED PAYOUT TURNS
-- ============================================================
-- Two (or more) fractional slots can share one turn: memberships that
-- carry the same shared_slot_key are partners. They keep their own daily
-- schedules and their own fraction of the cashout, but their payout dates
-- move together — change one, all partners follow.

ALTER TABLE group_memberships
  ADD COLUMN IF NOT EXISTS shared_slot_key UUID;

CREATE INDEX IF NOT EXISTS idx_gm_shared_slot
  ON group_memberships(shared_slot_key) WHERE shared_slot_key IS NOT NULL;
-- ============================================================
-- V14 — SLOT-ACCURATE MONEY MATHS
-- ============================================================
-- With multiple slots per member in one group (v13), anything that
-- aggregates contributions by member+group mixes the slots together:
-- each plan card would show the combined balance of all slots, and one
-- slot's unpaid days would be deducted from EVERY slot's payout —
-- double-counting arrears. Contributions therefore aggregate per
-- MEMBERSHIP (per slot).
--
-- Penalties stay member+group scoped: the release flow marks them paid
-- on the first payout, so they cannot double-deduct.

-- ── Per-slot payout eligibility ──
DROP FUNCTION IF EXISTS check_payout_eligibility(UUID);

CREATE FUNCTION check_payout_eligibility(p_payout_id UUID)
RETURNS TABLE (
  eligible            BOOLEAN,
  reason              TEXT,
  gross_amount        DECIMAL,
  outstanding_contrib DECIMAL,
  outstanding_penalty DECIMAL,
  registration_fee    DECIMAL,   -- reported for the record, never added
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

  -- Contributions for THIS slot only (fall back to member+group for any
  -- legacy payout row without a membership link)
  SELECT
    COALESCE(SUM(CASE WHEN status IN ('pending','overdue') THEN amount ELSE 0 END), 0),
    COUNT(CASE WHEN status = 'paid' THEN 1 END),
    COUNT(*)
  INTO v_out_c, v_paid, v_due
  FROM contributions
  WHERE (
      (v_payout.membership_id IS NOT NULL AND membership_id = v_payout.membership_id)
      OR
      (v_payout.membership_id IS NULL AND member_id = v_payout.member_id AND group_id = v_payout.group_id)
    )
    AND due_date <= v_payout.scheduled_date;

  -- Penalties: member+group; the release flow settles them so they only
  -- ever deduct once, on the first payout
  SELECT COALESCE(SUM(amount), 0) INTO v_out_p
  FROM payment_penalties
  WHERE member_id = v_payout.member_id
    AND group_id  = v_payout.group_id
    AND NOT is_paid;

  -- The registration fee is commission. It is NOT added here.
  v_net := v_payout.total_amount - v_out_c - v_out_p;

  IF v_out_c > 0 THEN
    v_eligible := false;
    v_reason := 'This slot has GHS ' || v_out_c::TEXT || ' in unpaid contributions due before its payout date';
  ELSIF v_out_p > 0 THEN
    v_eligible := true;
    v_reason := 'Eligible — GHS ' || v_out_p::TEXT || ' in penalties will be deducted';
  END IF;

  RETURN QUERY SELECT
    v_eligible, v_reason, v_payout.total_amount, v_out_c, v_out_p,
    COALESCE(v_group.registration_fee, 0),
    v_net, v_paid, v_due;
END;
$$;

-- ── Per-slot balance for the member portal ──
CREATE OR REPLACE FUNCTION get_membership_balance(p_membership_id UUID)
RETURNS TABLE (
  total_paid          DECIMAL,
  total_remaining     DECIMAL,
  total_overdue       DECIMAL,
  penalty_balance     DECIMAL,
  contributions_paid  INTEGER,
  contributions_total INTEGER
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE WHEN c.status = 'paid'    THEN c.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN c.status IN ('pending','overdue') THEN c.amount ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN c.status = 'overdue' THEN c.amount ELSE 0 END), 0),
    COALESCE((SELECT SUM(p.amount) FROM payment_penalties p
              JOIN contributions pc ON pc.id = p.contribution_id
              WHERE pc.membership_id = p_membership_id AND NOT p.is_paid), 0),
    COUNT(CASE WHEN c.status = 'paid' THEN 1 END)::INTEGER,
    COUNT(*)::INTEGER
  FROM contributions c
  WHERE c.membership_id = p_membership_id;
END;
$$;
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
-- ============================================================
-- V19 — WEBSITE VISIBILITY TOGGLE + DELETABLE GROUPS
-- ============================================================

-- The admin decides which groups the website shows, independent of
-- status: an active group can keep recruiting, a full one can be hidden.
ALTER TABLE susu_groups
  ADD COLUMN IF NOT EXISTS show_on_website BOOLEAN NOT NULL DEFAULT true;

-- Applications must not chain a group to existence forever. The first
-- choice becomes nullable so deleting a (money-less) group can detach
-- old applications instead of being blocked by them; the application
-- record itself survives.
ALTER TABLE kyc_applications
  ALTER COLUMN selected_group_id DROP NOT NULL;
-- ============================================================
-- V20 — PAYOUT REMINDER STAMP
-- ============================================================
-- Lets the scheduled payout-reminder job avoid texting twice if it runs more
-- than once for the same day.

ALTER TABLE payouts
  ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ;
