-- ============================================================================
-- v38 — REVERSING A PAYMENT, WITHOUT LEAVING THE LEDGER INCONSISTENT
-- ============================================================================
-- Additive. Nothing is deleted; one obsolete FUNCTION is dropped (no data).
--
-- THE DEFECT
-- ----------
-- `admin-undo-payment` restores a contribution to unpaid — status, paid_at,
-- amount_paid — and marks the transaction failed. It does not touch
-- `payment_allocations`, and it does not touch the credit ledger.
--
-- So after an undo, the allocation row still says this payment covered that
-- day, while the day says nothing paid it. That is exactly the shape financial
-- invariant #8 (`allocation_against_unsettled_day`) exists to detect — the
-- F-02 signature. An operator correcting a mistake would have tripped the
-- alarm built to catch a much more serious bug.
--
-- It also does four separate PostgREST writes with no transaction around them,
-- so a failure part-way leaves a day unpaid with its payment still successful.
--
-- No production reversal has hit this: the 164 historical reversals are all
-- from July, and the allocation ledger only starts on 24 July. This is a
-- forward-looking fix, not a repair.
--
-- HOW HISTORY IS PRESERVED
-- ------------------------
-- A reversed allocation is STAMPED, never deleted. Reversed credit is an
-- offsetting NEGATIVE entry, never an edit — the ledger stays append-only. The
-- full before-state goes to `settlement_log`. Nothing that records money
-- having moved is removed.
-- ============================================================================

ALTER TABLE payment_allocations
  ADD COLUMN IF NOT EXISTS reversed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS reversal_reason text;

CREATE INDEX IF NOT EXISTS idx_alloc_live ON payment_allocations(contribution_id)
  WHERE reversed_at IS NULL;

-- ============================================================================
-- reverse_contribution_payment — one transaction, one lock, full trail
-- ============================================================================
CREATE OR REPLACE FUNCTION reverse_contribution_payment(
  p_contribution_id uuid,
  p_admin_id        uuid,
  p_admin_name      text,
  p_reason          text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_c          contributions%ROWTYPE;
  v_today      date := (now() AT TIME ZONE 'UTC')::date;
  v_restored   text;
  v_freed      numeric := 0;
  v_refs       text[];
  v_ref        text;
  v_credit_rev numeric := 0;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 10 THEN
    RAISE EXCEPTION 'A reversal needs a reason of at least 10 characters';
  END IF;

  SELECT * INTO v_c FROM contributions WHERE id = p_contribution_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contribution % not found', p_contribution_id;
  END IF;
  IF v_c.status <> 'paid' AND COALESCE(v_c.amount_paid, 0) < 0.005 THEN
    RAISE EXCEPTION 'Nothing has been paid against this day, so there is nothing to reverse';
  END IF;

  -- Which payments had claimed this day? Stamped, not deleted.
  SELECT COALESCE(sum(pa.amount), 0), COALESCE(array_agg(DISTINCT pa.reference), '{}')
    INTO v_freed, v_refs
    FROM payment_allocations pa
   WHERE pa.contribution_id = p_contribution_id AND pa.reversed_at IS NULL;

  UPDATE payment_allocations
     SET reversed_at = now(), reversal_reason = p_reason
   WHERE contribution_id = p_contribution_id AND reversed_at IS NULL;

  v_restored := CASE WHEN v_c.due_date < v_today THEN 'overdue' ELSE 'pending' END;

  UPDATE contributions
     SET status = v_restored::contribution_status,
         paid_at = NULL, paystack_ref = NULL, payment_method = NULL, amount_paid = 0
   WHERE id = p_contribution_id;

  UPDATE payment_penalties
     SET is_paid = false, paid_at = NULL
   WHERE contribution_id = p_contribution_id;

  -- Each payment that had claimed this day is marked failed — the reversal
  -- asserts the money did not arrive. If that payment ALSO banked surplus as
  -- credit, that credit came from the same money and must go back with it:
  -- an offsetting negative entry, so the append-only ledger keeps both facts.
  FOREACH v_ref IN ARRAY v_refs LOOP
    UPDATE transactions
       SET status = 'failed',
           description = COALESCE(description, '') || ' — reversed by ' || COALESCE(p_admin_name, 'admin') || ': ' || p_reason
     WHERE reference = v_ref AND status = 'success';

    IF NOT EXISTS (SELECT 1 FROM payment_allocations
                    WHERE reference = v_ref AND reversed_at IS NULL) THEN
      INSERT INTO membership_credit_ledger
        (membership_id, member_id, amount, entry_type, source_reference,
         contribution_id, note, created_by)
      SELECT l.membership_id, l.member_id, -l.amount, 'reversal', v_ref,
             p_contribution_id,
             'Reversal of credit banked by ' || v_ref || ' — ' || p_reason,
             COALESCE(p_admin_name, 'admin')
        FROM membership_credit_ledger l
       WHERE l.source_reference = v_ref AND l.entry_type <> 'reversal'
         AND NOT EXISTS (SELECT 1 FROM membership_credit_ledger r
                          WHERE r.source_reference = v_ref AND r.entry_type = 'reversal');
      GET DIAGNOSTICS v_credit_rev = ROW_COUNT;
    END IF;
  END LOOP;

  -- The whole before-state, appended. A reversal must be as legible
  -- afterwards as the settlement it undid.
  INSERT INTO settlement_log (reference, event, member_id, amount, detail)
  VALUES (COALESCE(v_refs[1], 'manual'), 'settlement_reversed', v_c.member_id, v_freed,
          jsonb_build_object(
            'contribution_id', p_contribution_id,
            'due_date',        v_c.due_date,
            'was_status',      v_c.status,
            'was_amount_paid', v_c.amount_paid,
            'was_paid_at',     v_c.paid_at,
            'restored_to',     v_restored,
            'references',      to_jsonb(v_refs),
            'credit_entries_reversed', v_credit_rev,
            'reason',          p_reason,
            'by',              p_admin_name));

  INSERT INTO audit_log (admin_id, admin_name, action, entity_type, entity_id,
                         entity_label, details)
  VALUES (p_admin_id, COALESCE(p_admin_name, 'admin'), 'payment.reversed',
          'contribution', p_contribution_id,
          v_c.due_date::text || ' — GHS ' || COALESCE(v_c.amount_paid, v_c.amount)::text,
          jsonb_build_object('reason', p_reason, 'freed', v_freed,
                             'references', to_jsonb(v_refs), 'restored_to', v_restored));

  RETURN jsonb_build_object(
    'reversed', true, 'restored_to', v_restored, 'freed', v_freed,
    'references', to_jsonb(v_refs), 'credit_entries_reversed', v_credit_rev);
END;
$$;

REVOKE ALL ON FUNCTION reverse_contribution_payment(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION reverse_contribution_payment(uuid, uuid, text, text) TO service_role;

-- ============================================================================
-- Drop the superseded one-argument statement
-- ============================================================================
-- A second statement implementation, from before the rebuild. It reads
-- `status='paid'` only — so a part-paid day reports zero — has no accounting
-- identity, no opening or closing balance, and no attribution. Nothing calls
-- it; the portal uses the four-argument version. Two functions of the same
-- name that disagree about what a member has paid is precisely the
-- duplicate-engine problem this rebuild set out to end, and an overload is an
-- easy one to invoke by accident.
DROP FUNCTION IF EXISTS get_member_statement(uuid);
