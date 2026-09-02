-- ============================================================================
-- V30 — PAYMENT PREVIEW, BY RUNNING THE REAL SETTLEMENT  (Phase 04)
-- ============================================================================
-- The member must be told what a payment will cover BEFORE they approve it,
-- and the specification is explicit that "the preview must never invent a
-- different result".
--
-- The usual way to build a preview is to reimplement the allocation rule in
-- read-only form. That is how you end up with two rules that agree today and
-- drift next quarter — which is the disease this entire rebuild is treating.
--
-- So this does not reimplement anything. `preview_settlement()` runs
-- `settle_payment()` — the real one, the same function that will move the
-- money — inside a savepoint, captures what it decided, and then rolls that
-- savepoint back. The preview is not *equivalent* to the settlement; it IS the
-- settlement, executed and undone.
--
-- The same technique the conformance harness used to test against production
-- without leaving a trace, applied as a product feature.
--
-- Read-only by construction: every write the inner call makes is discarded.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS preview_settlement(TEXT, DECIMAL, TEXT, DATE);

CREATE FUNCTION preview_settlement(
  p_reference        TEXT,
  p_confirmed_amount DECIMAL DEFAULT NULL,
  p_scope            TEXT    DEFAULT 'member',
  p_as_of            DATE    DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
  v_member UUID;
  v_origin UUID;
BEGIN
  SELECT t.member_id INTO v_member FROM transactions t WHERE t.reference = p_reference;
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'No payment with reference %', p_reference USING ERRCODE = 'no_data_found';
  END IF;

  SELECT c.membership_id INTO v_origin
  FROM transactions t JOIN contributions c ON c.id = t.related_id
  WHERE t.reference = p_reference;

  BEGIN
    -- The real settlement. Every write below is undone before we return.
    PERFORM settle_payment(p_reference, p_confirmed_amount, p_scope, p_as_of);

    SELECT jsonb_build_object(
      'reference', p_reference,
      'amount',    COALESCE(p_confirmed_amount, (SELECT t.amount FROM transactions t WHERE t.reference = p_reference)),
      'as_of',     p_as_of,
      'scope',     p_scope,
      'covers', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'contribution_id', pa.contribution_id,
                 'membership_id',   pa.membership_id,
                 'group_name',      pa.group_name,
                 'due_date',        pa.due_date,
                 'amount',          pa.amount,
                 'kind',            pa.kind,
                 -- What will still be owed on that day after this payment.
                 'remaining_after', GREATEST(
                    c.amount + COALESCE(c.penalty_due,0) - c.amount_paid, 0))
               ORDER BY pa.due_date, pa.group_name)
        FROM payment_allocations pa
        JOIN contributions c ON c.id = pa.contribution_id
        WHERE pa.reference = p_reference), '[]'::jsonb),
      'days_fully_covered', (
        SELECT count(*) FROM payment_allocations WHERE reference = p_reference AND kind = 'full'),
      'days_partly_covered', (
        SELECT count(*) FROM payment_allocations WHERE reference = p_reference AND kind = 'part'),
      'total_allocated', COALESCE((
        SELECT sum(amount) FROM payment_allocations WHERE reference = p_reference), 0),
      -- Credit this payment would leave on the originating membership.
      'credit_after', COALESCE((
        SELECT sum(l.amount) FROM membership_credit_ledger l
        WHERE l.membership_id = v_origin), 0),
      'memberships_touched', (
        SELECT count(DISTINCT membership_id) FROM payment_allocations WHERE reference = p_reference)
    ) INTO v_result;

    -- Undo everything the settlement just did.
    RAISE EXCEPTION 'PREVIEW_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'PREVIEW_ROLLBACK' THEN
      RAISE;   -- a genuine failure must not be disguised as a preview
    END IF;
  END;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION preview_settlement(TEXT, DECIMAL, TEXT, DATE) IS
  'What a payment will cover. Runs the REAL settle_payment() inside a savepoint '
  'and rolls it back, so the preview cannot diverge from the settlement — it is '
  'the same execution. Read-only by construction.';

REVOKE ALL ON FUNCTION preview_settlement(TEXT, DECIMAL, TEXT, DATE) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION preview_settlement(TEXT,DECIMAL,TEXT,DATE) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION preview_settlement(TEXT,DECIMAL,TEXT,DATE) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION preview_settlement(TEXT,DECIMAL,TEXT,DATE) TO service_role';
  END IF;
END $$;

COMMIT;
