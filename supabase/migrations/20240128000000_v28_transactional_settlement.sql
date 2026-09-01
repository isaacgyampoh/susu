-- ============================================================================
-- V28 — THE CANONICAL SETTLEMENT FUNCTION  (Phase 03)
-- ============================================================================
-- One place money is applied to obligations. Atomic, locked, idempotent.
--
-- ── WHY THIS EXISTS ──────────────────────────────────────────────────────
-- Five implementations of "apply money to obligations" are live today, and
-- they disagree:
--
--   settle.ts settlePayment()      allocations yes · amount_paid yes · NO lock
--   payments-verify batch branch   allocations NO  · amount_paid no
--   payments-bulk dev branch       allocations NO  · amount_paid no
--   payments-manual bulk           allocations NO  · amount_paid no · locked
--   record_partial_payment()       allocations NO  · amount_paid yes · atomic
--
-- Only one writes the audit ledger, and it is the only online path with no
-- conditional update. settle.ts issues every write as a separate PostgREST
-- call with no transaction, so a failure part-way leaves days paid, the
-- allocation ledger short, and credit unreconciled — with nothing to roll back.
--
-- It also reads members.credit_balance, then writes it back at the end. Two
-- concurrent settlements both read the same value and both spend it.
--
-- This function replaces all five. It runs inside one transaction, takes row
-- locks before it decides anything, and either every allocation, every
-- contribution update and every credit movement lands together, or none does.
--
-- ── ALLOCATION POLICY ────────────────────────────────────────────────────
-- LEGACY_SLOT_FIRST — confirmed from production as the ordering the deployed
-- settle.ts actually implements:
--
--   1. the membership the payment was made against, its obligations in
--      due-date order (INCLUDING future days)
--   2. then every other membership the member holds, in due-date order
--
-- This is NOT arrears-first. A member's future day in the paid slot is settled
-- before another slot's overdue day. settle.ts's own header claims the
-- opposite ("arrears before paying ahead, always") but its queue construction
-- does this, and production is the authority.
--
-- Switching to arrears-first is a deliberate business change that moves real
-- balances. It is deliberately NOT made here. The policy is a parameter so the
-- change is a decision, not a refactor.
--
-- This mirrors src/domain/contribution/policy.ts LEGACY_SLOT_FIRST exactly,
-- and the conformance suite fails the build if the two ever diverge.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS settlement_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference     TEXT NOT NULL,
  event         TEXT NOT NULL,
  member_id     UUID,
  amount        DECIMAL(10,2),
  days_settled  INTEGER,
  credit_used   DECIMAL(10,2),
  credit_banked DECIMAL(10,2),
  detail        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_settlement_log_ref ON settlement_log(reference, created_at DESC);
ALTER TABLE settlement_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE settlement_log IS
  'Structured record of every settlement attempt and its outcome. Carries no '
  'passcodes, tokens or provider secrets — identifiers and amounts only.';


DROP FUNCTION IF EXISTS settle_payment(TEXT, DECIMAL, TEXT, DATE);

CREATE FUNCTION settle_payment(
  p_reference        TEXT,
  p_confirmed_amount DECIMAL DEFAULT NULL,   -- what the provider says arrived
  p_scope            TEXT    DEFAULT 'member',
  p_as_of            DATE    DEFAULT CURRENT_DATE
)
-- OUT parameters are prefixed because a RETURNS TABLE column name becomes an
-- implicit PL/pgSQL variable: an unqualified `membership_id` inside the body
-- would then be ambiguous against the table column of the same name, and
-- PostgreSQL raises 42702 at runtime rather than at deploy time.
RETURNS TABLE (
  o_contribution_id UUID,
  o_membership_id   UUID,
  o_group_name      TEXT,
  o_due_date        DATE,
  o_amount_applied  DECIMAL,
  o_kind            TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tx            transactions%ROWTYPE;
  v_origin_ms     UUID;
  v_member        UUID;
  v_left          DECIMAL(10,2);
  v_ob            RECORD;
  v_owed          DECIMAL(10,2);
  v_credit        DECIMAL(10,2);
  v_credit_part   DECIMAL(10,2);
  v_cash_part     DECIMAL(10,2);
  v_applied       DECIMAL(10,2);
  v_days          INTEGER := 0;
  v_credit_used   DECIMAL(10,2) := 0;
  v_now           TIMESTAMPTZ := NOW();
BEGIN
  -- ── 1. Lock the payment. Everything else follows from this. ────────────
  -- FOR UPDATE serialises concurrent settlement of the SAME payment: the
  -- second caller blocks here, and by the time it proceeds the first has
  -- committed and the status check below turns it into a no-op.
  SELECT * INTO v_tx FROM transactions WHERE reference = p_reference FOR UPDATE;

  IF v_tx.id IS NULL THEN
    RAISE EXCEPTION 'No payment with reference %', p_reference
      USING ERRCODE = 'no_data_found';
  END IF;

  -- ── 2. Idempotency. ───────────────────────────────────────────────────
  -- A provider may deliver the same callback ten times. The first settles;
  -- every subsequent one returns what was already recorded and writes nothing.
  IF v_tx.status = 'success' THEN
    INSERT INTO settlement_log (reference, event, member_id, detail)
    VALUES (p_reference, 'settlement_skipped_already_settled', v_tx.member_id,
            jsonb_build_object('reason', 'transaction already success'));

    RETURN QUERY
      SELECT pa.contribution_id, pa.membership_id, pa.group_name, pa.due_date,
             pa.amount, pa.kind
      FROM payment_allocations pa
      WHERE pa.reference = p_reference
      ORDER BY pa.due_date, pa.contribution_id;
    RETURN;
  END IF;

  IF v_tx.status = 'failed' THEN
    RAISE EXCEPTION 'Payment % is marked failed and cannot be settled', p_reference
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_member := v_tx.member_id;

  -- The amount to apply is the CONTRIBUTION value, never the grossed-up charge:
  -- the service fee is the operator's, not the member's savings. If the
  -- provider confirmed a different figure, the smaller of the two governs — we
  -- never credit more than actually arrived.
  v_left := LEAST(COALESCE(p_confirmed_amount, v_tx.amount), v_tx.amount);
  IF v_left IS NULL OR v_left < 0 THEN
    RAISE EXCEPTION 'Refusing to settle % with a non-positive amount', p_reference
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Which slot did the member pay into?
  SELECT c.membership_id INTO v_origin_ms
  FROM contributions c WHERE c.id = v_tx.related_id;

  INSERT INTO settlement_log (reference, event, member_id, amount, detail)
  VALUES (p_reference, 'settlement_started', v_member, v_left,
          jsonb_build_object('scope', p_scope, 'origin_membership', v_origin_ms, 'as_of', p_as_of));

  -- ── 3. Lock every obligation this payment may touch, in a stable order. ─
  -- Ordering the lock acquisition identically in every caller is what prevents
  -- deadlock between two settlements for the same member.
  CREATE TEMP TABLE IF NOT EXISTS _queue (
    id UUID, membership_id UUID, group_id UUID, group_name TEXT,
    due_date DATE, amount DECIMAL(10,2), amount_paid DECIMAL(10,2),
    penalty DECIMAL(10,2), rank_origin INT
  ) ON COMMIT DROP;
  DELETE FROM _queue;

  INSERT INTO _queue
  SELECT c.id, c.membership_id, c.group_id, COALESCE(g.name,'Susu'),
         c.due_date, c.amount, COALESCE(c.amount_paid,0), COALESCE(c.penalty_due,0),
         CASE WHEN c.membership_id = v_origin_ms THEN 0 ELSE 1 END
  FROM contributions c
  LEFT JOIN susu_groups g ON g.id = c.group_id
  WHERE c.status <> 'paid'
    AND c.member_id = v_member
    AND (
      p_scope = 'member'
      OR (p_scope = 'slot' AND c.membership_id = v_origin_ms)
    )
  ORDER BY c.id
  FOR UPDATE OF c;

  -- ── 4. Allocate, in the canonical order. ──────────────────────────────
  FOR v_ob IN
    SELECT * FROM _queue ORDER BY rank_origin, due_date, id
  LOOP
    -- Nothing left to give: neither cash nor credit on this slot.
    IF v_left <= 0.005 THEN
      SELECT COALESCE(sum(l.amount),0) INTO v_credit
      FROM membership_credit_ledger l WHERE l.membership_id = v_ob.membership_id;
      CONTINUE WHEN v_credit <= 0.005;
    END IF;

    v_owed := v_ob.amount + v_ob.penalty - v_ob.amount_paid;
    CONTINUE WHEN v_owed <= 0.005;

    -- This membership's own credit is spent first, and can never reach another.
    SELECT COALESCE(sum(l.amount),0) INTO v_credit
    FROM membership_credit_ledger l WHERE l.membership_id = v_ob.membership_id;

    v_credit_part := LEAST(GREATEST(v_credit,0), v_owed);
    v_cash_part   := LEAST(v_left, v_owed - v_credit_part);
    v_applied     := v_credit_part + v_cash_part;
    CONTINUE WHEN v_applied <= 0.005;

    IF v_credit_part > 0.005 THEN
      INSERT INTO membership_credit_ledger
        (membership_id, member_id, amount, entry_type, source_reference, contribution_id, note, created_by)
      VALUES (v_ob.membership_id, v_member, -v_credit_part, 'applied', p_reference, v_ob.id,
              'Applied to obligation due ' || v_ob.due_date, 'settle_payment');
      v_credit_used := v_credit_used + v_credit_part;
    END IF;

    v_left := v_left - v_cash_part;

    UPDATE contributions
    SET amount_paid  = v_ob.amount_paid + v_applied,
        status       = CASE WHEN v_owed - v_applied <= 0.005 THEN 'paid' ELSE status END,
        paid_at      = CASE WHEN v_owed - v_applied <= 0.005 THEN COALESCE(paid_at, v_now) ELSE paid_at END,
        paystack_ref = COALESCE(paystack_ref, p_reference)
    WHERE id = v_ob.id;

    IF v_owed - v_applied <= 0.005 THEN
      v_days := v_days + 1;
      UPDATE payment_penalties p SET is_paid = true, paid_at = v_now
      WHERE p.contribution_id = v_ob.id AND NOT p.is_paid;
    END IF;

    -- ON CONFLICT makes a replayed settlement a no-op at the row level too,
    -- backing the transaction-level idempotency with a database constraint.
    INSERT INTO payment_allocations
      (reference, member_id, contribution_id, membership_id, group_id, group_name, due_date, amount, kind)
    VALUES (p_reference, v_member, v_ob.id, v_ob.membership_id, v_ob.group_id,
            v_ob.group_name, v_ob.due_date, v_applied,
            CASE WHEN v_owed - v_applied <= 0.005 THEN 'full' ELSE 'part' END)
    ON CONFLICT (reference, contribution_id) DO NOTHING;

    RETURN QUERY SELECT v_ob.id, v_ob.membership_id, v_ob.group_name, v_ob.due_date,
                        v_applied, CASE WHEN v_owed - v_applied <= 0.005 THEN 'full' ELSE 'part' END;
  END LOOP;

  -- ── 5. Bank any surplus against the slot it was paid into. ────────────
  IF v_left > 0.005 THEN
    IF v_origin_ms IS NULL THEN
      RAISE EXCEPTION 'Payment % has GHS % unallocated and no originating membership to bank it against',
        p_reference, v_left USING ERRCODE = 'invalid_parameter_value';
    END IF;
    INSERT INTO membership_credit_ledger
      (membership_id, member_id, amount, entry_type, source_reference, note, created_by)
    VALUES (v_origin_ms, v_member, v_left, 'surplus', p_reference,
            'Overpayment held against this membership', 'settle_payment');
  END IF;

  -- ── 6. Only now is the payment settled. ───────────────────────────────
  UPDATE transactions SET status = 'success' WHERE id = v_tx.id;

  INSERT INTO settlement_log
    (reference, event, member_id, amount, days_settled, credit_used, credit_banked, detail)
  VALUES (p_reference, 'settlement_completed', v_member,
          COALESCE(p_confirmed_amount, v_tx.amount), v_days, v_credit_used, GREATEST(v_left,0),
          jsonb_build_object('scope', p_scope, 'origin_membership', v_origin_ms));
END;
$$;

COMMENT ON FUNCTION settle_payment(TEXT, DECIMAL, TEXT, DATE) IS
  'The one place money is applied to obligations. Atomic, row-locked and '
  'idempotent. Mirrors src/domain/contribution/allocation.ts under the '
  'LEGACY_SLOT_FIRST policy; the conformance suite fails if they diverge.';

-- Callable only by the Edge Functions, consistent with v25.
REVOKE ALL ON FUNCTION settle_payment(TEXT, DECIMAL, TEXT, DATE) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION settle_payment(TEXT, DECIMAL, TEXT, DATE) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION settle_payment(TEXT, DECIMAL, TEXT, DATE) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION settle_payment(TEXT, DECIMAL, TEXT, DATE) TO service_role';
  END IF;
END $$;

COMMIT;
