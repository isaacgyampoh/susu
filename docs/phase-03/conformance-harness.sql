-- ============================================================================
-- CONFORMANCE HARNESS — prove settle_payment() matches the pure allocator
-- ============================================================================
-- Builds a scenario in a transaction, settles it with the REAL production
-- function, captures the resulting allocations, then rolls the data back.
--
-- The rollback is done by raising a sentinel exception inside a nested block:
-- PL/pgSQL undoes the DATA changes but the captured variable survives, so the
-- result can be returned from a run that left no trace.
--
-- Everything lives in its own schema so it can be dropped whole. Nothing here
-- is intended to remain in production after a conformance run.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS conformance;

CREATE OR REPLACE FUNCTION conformance.run_scenario(
  p_daily      DECIMAL,        -- cost per obligation day
  p_days       INTEGER,        -- how many days to generate
  p_paid_days  INTEGER,        -- how many are already settled
  p_payment    DECIMAL,        -- what the member pays now
  p_start      DATE,           -- first due date
  p_scope      TEXT DEFAULT 'member',
  p_extra_memberships INTEGER DEFAULT 0,   -- other slots, to test isolation
  p_partial_on_next DECIMAL DEFAULT 0      -- pre-existing part payment
) RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result   JSONB;
  v_member   UUID := gen_random_uuid();
  v_group    UUID := gen_random_uuid();
  v_ms       UUID := gen_random_uuid();
  v_ref      TEXT := 'CONFORMANCE-' || gen_random_uuid()::text;
  v_first    UUID;
  i          INTEGER;
  j          INTEGER;
  v_g2       UUID;
  v_ms2      UUID;
BEGIN
  BEGIN
    -- ── fixtures ────────────────────────────────────────────────────────
    INSERT INTO members (id, member_id, full_name, phone, ghana_card_number, status)
    VALUES (v_member, 'CONF-' || substr(v_member::text,1,8), 'Conformance Subject',
            'conf-' || v_member::text, 'GHA-' || v_member::text, 'active');

    INSERT INTO susu_groups (id, name, contribution_amount, contribution_frequency,
                             cycle_days, max_members, registration_fee, cashout_amount, status)
    VALUES (v_group, 'Conformance Group A', p_daily, 'daily', 30, 10, 0, p_daily*300, 'active');

    INSERT INTO group_memberships (id, member_id, group_id, payout_position, status, slot_fraction)
    VALUES (v_ms, v_member, v_group, 1, 'active', 1);

    FOR i IN 0..(p_days-1) LOOP
      INSERT INTO contributions (member_id, group_id, membership_id, amount, amount_paid,
                                 due_date, status, cycle_number)
      VALUES (v_member, v_group, v_ms, p_daily,
              CASE WHEN i < p_paid_days THEN p_daily
                   WHEN i = p_paid_days THEN p_partial_on_next ELSE 0 END,
              p_start + i,
              CASE WHEN i < p_paid_days THEN 'paid' ELSE 'pending' END::contribution_status,
              1)
      RETURNING id INTO v_first;
      IF i = p_paid_days THEN NULL; END IF;
    END LOOP;

    -- The obligation the payment is nominally "for": first unsettled day.
    SELECT id INTO v_first FROM contributions
    WHERE membership_id = v_ms AND status <> 'paid' ORDER BY due_date LIMIT 1;

    -- Additional memberships in other groups, to prove isolation.
    FOR j IN 1..p_extra_memberships LOOP
      v_g2  := gen_random_uuid();
      v_ms2 := gen_random_uuid();
      INSERT INTO susu_groups (id, name, contribution_amount, contribution_frequency,
                               cycle_days, max_members, registration_fee, cashout_amount, status)
      VALUES (v_g2, 'Conformance Group ' || chr(65+j), p_daily, 'daily', 30, 10, 0, p_daily*300, 'active');
      INSERT INTO group_memberships (id, member_id, group_id, payout_position, status, slot_fraction)
      VALUES (v_ms2, v_member, v_g2, 1, 'active', 1);
      FOR i IN 0..(p_days-1) LOOP
        INSERT INTO contributions (member_id, group_id, membership_id, amount, amount_paid,
                                   due_date, status, cycle_number)
        VALUES (v_member, v_g2, v_ms2, p_daily, 0, p_start + i, 'pending'::contribution_status, 1);
      END LOOP;
    END LOOP;

    INSERT INTO transactions (member_id, type, amount, reference, status, related_id, description)
    VALUES (v_member, 'contribution', p_payment, v_ref, 'pending', v_first, 'conformance');

    -- ── settle with the REAL production function ────────────────────────
    PERFORM settle_payment(v_ref, p_payment, p_scope, p_start);

    -- ── capture ─────────────────────────────────────────────────────────
    SELECT jsonb_build_object(
      'allocations', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'due_date', pa.due_date, 'amount', pa.amount::text,
                 'kind', pa.kind, 'group', pa.group_name)
               ORDER BY pa.due_date, pa.group_name)
        FROM payment_allocations pa WHERE pa.reference = v_ref), '[]'::jsonb),
      'credit_after', COALESCE((
        SELECT sum(amount) FROM membership_credit_ledger WHERE membership_id = v_ms), 0)::text,
      'days_settled', (
        SELECT count(*) FROM payment_allocations WHERE reference = v_ref AND kind='full'),
      'total_allocated', COALESCE((
        SELECT sum(amount) FROM payment_allocations WHERE reference = v_ref), 0)::text,
      'other_memberships_touched', (
        SELECT count(DISTINCT membership_id) FROM payment_allocations
        WHERE reference = v_ref AND membership_id <> v_ms)
    ) INTO v_result;

    RAISE EXCEPTION 'CONFORMANCE_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'CONFORMANCE_ROLLBACK' THEN
      RAISE;
    END IF;
  END;

  RETURN v_result;
END;
$$;
