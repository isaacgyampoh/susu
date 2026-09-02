-- ============================================================================
-- V33 — SETTLEMENT MUST WORK THROUGH PostgREST  (Phase 05)
-- ============================================================================
-- settle_payment() worked when called directly as `postgres`, and every
-- conformance test passed — because those tests ran through the Management API,
-- which executes SQL directly.
--
-- The Edge Functions call it through PostgREST (supabaseAdmin.rpc(...)), and
-- Supabase enables a `safeupdate` guard on that path which rejects any
-- unqualified DELETE or UPDATE. The function contained:
--
--     DELETE FROM _queue;
--
-- on its temporary work table. Harmless in itself, and fatal in context:
--
--     ERROR: DELETE requires a WHERE clause
--
-- So every settlement invoked from an Edge Function would have failed on the
-- first real payment after deployment. The live IDOR control test caught it —
-- a preview returned 500 where it should have returned an allocation.
--
-- The fix is one predicate. `WHERE true` satisfies the guard and is identical
-- in meaning.
--
-- Everything else in the function is unchanged from v32.
-- ============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION settle_payment(
  p_reference             TEXT,
  p_confirmed_amount      DECIMAL  DEFAULT NULL,
  p_scope                 TEXT     DEFAULT 'member',
  p_as_of                 DATE     DEFAULT CURRENT_DATE,
  p_target_contributions  UUID[]   DEFAULT NULL
)
RETURNS TABLE (
  o_contribution_id UUID, o_membership_id UUID, o_group_name TEXT,
  o_due_date DATE, o_amount_applied DECIMAL, o_kind TEXT
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_tx transactions%ROWTYPE; v_origin_ms UUID; v_member UUID;
  v_left DECIMAL(10,2); v_ob RECORD; v_owed DECIMAL(10,2);
  v_credit DECIMAL(10,2); v_credit_part DECIMAL(10,2); v_cash_part DECIMAL(10,2);
  v_applied DECIMAL(10,2); v_days INTEGER := 0; v_credit_used DECIMAL(10,2) := 0;
  v_directed BOOLEAN := p_target_contributions IS NOT NULL
                        AND array_length(p_target_contributions, 1) > 0;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_tx FROM transactions WHERE reference = p_reference FOR UPDATE;
  IF v_tx.id IS NULL THEN
    RAISE EXCEPTION 'No payment with reference %', p_reference USING ERRCODE = 'no_data_found';
  END IF;

  IF v_tx.status = 'success' THEN
    INSERT INTO settlement_log (reference, event, member_id, detail)
    VALUES (p_reference, 'settlement_skipped_already_settled', v_tx.member_id,
            jsonb_build_object('reason', 'transaction already success'));
    RETURN QUERY
      SELECT pa.contribution_id, pa.membership_id, pa.group_name, pa.due_date, pa.amount, pa.kind
      FROM payment_allocations pa WHERE pa.reference = p_reference
      ORDER BY pa.due_date, pa.contribution_id;
    RETURN;
  END IF;

  IF v_tx.status = 'failed' THEN
    RAISE EXCEPTION 'Payment % is marked failed and cannot be settled', p_reference
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  v_member := v_tx.member_id;
  v_left := LEAST(COALESCE(p_confirmed_amount, v_tx.amount), v_tx.amount);
  IF v_left IS NULL OR v_left < 0 THEN
    RAISE EXCEPTION 'Refusing to settle % with a non-positive amount', p_reference
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT c.membership_id INTO v_origin_ms FROM contributions c WHERE c.id = v_tx.related_id;

  INSERT INTO settlement_log (reference, event, member_id, amount, detail)
  VALUES (p_reference, 'settlement_started', v_member, v_left,
          jsonb_build_object('scope', p_scope, 'origin_membership', v_origin_ms,
                             'as_of', p_as_of, 'directed', v_directed));

  CREATE TEMP TABLE IF NOT EXISTS _queue (
    id UUID, membership_id UUID, group_id UUID, group_name TEXT,
    due_date DATE, amount DECIMAL(10,2), amount_paid DECIMAL(10,2),
    penalty DECIMAL(10,2), rank_origin INT
  ) ON COMMIT DROP;

  -- WHERE true: PostgREST runs with a guard that rejects an unqualified
  -- DELETE, and every Edge Function reaches this function through PostgREST.
  DELETE FROM _queue WHERE true;

  INSERT INTO _queue
  SELECT c.id, c.membership_id, c.group_id, COALESCE(g.name,'Susu'),
         c.due_date, c.amount, COALESCE(c.amount_paid,0), COALESCE(c.penalty_due,0),
         CASE WHEN c.membership_id = v_origin_ms THEN 0 ELSE 1 END
  FROM contributions c
  LEFT JOIN susu_groups g ON g.id = c.group_id
  WHERE c.status <> 'paid' AND c.member_id = v_member
    AND ( (v_directed AND c.id = ANY(p_target_contributions))
       OR (NOT v_directed AND (p_scope = 'member'
            OR (p_scope = 'slot' AND c.membership_id = v_origin_ms))) )
  ORDER BY c.id
  FOR UPDATE OF c;

  FOR v_ob IN
    SELECT * FROM _queue
    ORDER BY CASE WHEN v_directed THEN 0 ELSE rank_origin END, due_date, id
  LOOP
    IF v_left <= 0.005 THEN
      SELECT COALESCE(sum(l.amount),0) INTO v_credit
      FROM membership_credit_ledger l WHERE l.membership_id = v_ob.membership_id;
      CONTINUE WHEN v_credit <= 0.005;
    END IF;

    v_owed := v_ob.amount + v_ob.penalty - v_ob.amount_paid;
    CONTINUE WHEN v_owed <= 0.005;

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

    INSERT INTO payment_allocations
      (reference, member_id, contribution_id, membership_id, group_id, group_name, due_date, amount, kind)
    VALUES (p_reference, v_member, v_ob.id, v_ob.membership_id, v_ob.group_id,
            v_ob.group_name, v_ob.due_date, v_applied,
            CASE WHEN v_owed - v_applied <= 0.005 THEN 'full' ELSE 'part' END)
    ON CONFLICT (reference, contribution_id) DO NOTHING;

    RETURN QUERY SELECT v_ob.id, v_ob.membership_id, v_ob.group_name, v_ob.due_date,
                        v_applied, CASE WHEN v_owed - v_applied <= 0.005 THEN 'full' ELSE 'part' END;
  END LOOP;

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

  UPDATE transactions SET status = 'success' WHERE id = v_tx.id;

  INSERT INTO settlement_log
    (reference, event, member_id, amount, days_settled, credit_used, credit_banked, detail)
  VALUES (p_reference, 'settlement_completed', v_member,
          COALESCE(p_confirmed_amount, v_tx.amount), v_days, v_credit_used, GREATEST(v_left,0),
          jsonb_build_object('scope', p_scope, 'origin_membership', v_origin_ms, 'directed', v_directed));
END;
$$;

COMMIT;
