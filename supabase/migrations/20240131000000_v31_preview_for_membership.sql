-- ============================================================================
-- V31 — PREVIEW A PAYMENT THAT DOES NOT EXIST YET  (Phase 04)
-- ============================================================================
-- `preview_settlement()` (v30) previews an EXISTING pending payment. The portal
-- needs to preview a payment the member has not made yet: they are typing an
-- amount and want to know what it would cover before they approve anything.
--
-- Rather than reimplement the allocation rule in a read-only form — the very
-- duplication this rebuild exists to remove — this constructs the payment
-- inside the savepoint, runs the REAL settlement against it, captures the
-- result, and rolls the whole thing back. The transaction row it creates never
-- exists outside the savepoint.
--
-- So the preview is not a model of the settlement. It is the settlement, run
-- and undone.
--
-- Read-only by construction. Authorization is the caller's responsibility:
-- the edge function must confirm the membership belongs to the session member
-- before calling this.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS preview_payment_for_membership(UUID, DECIMAL, BOOLEAN, DATE);

CREATE FUNCTION preview_payment_for_membership(
  p_membership_id UUID,
  p_amount        DECIMAL,
  p_this_only     BOOLEAN DEFAULT true,
  p_as_of         DATE    DEFAULT CURRENT_DATE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result  JSONB;
  v_member  UUID;
  v_target  UUID;
  v_ref     TEXT;
  v_scope   TEXT := CASE WHEN p_this_only THEN 'slot' ELSE 'member' END;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Preview needs a positive amount' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT gm.member_id INTO v_member
  FROM group_memberships gm WHERE gm.id = p_membership_id AND gm.status = 'active';

  IF v_member IS NULL THEN
    RAISE EXCEPTION 'No active membership %', p_membership_id USING ERRCODE = 'no_data_found';
  END IF;

  -- The obligation the payment is nominally against: this membership's oldest
  -- unsettled day. It anchors the allocation to the right slot.
  SELECT c.id INTO v_target
  FROM contributions c
  WHERE c.membership_id = p_membership_id AND c.status <> 'paid'
  ORDER BY c.due_date LIMIT 1;

  IF v_target IS NULL THEN
    -- Nothing owing. The whole amount would become credit on this membership.
    RETURN jsonb_build_object(
      'amount', p_amount, 'covers', '[]'::jsonb,
      'days_fully_covered', 0, 'days_partly_covered', 0,
      'total_allocated', 0, 'credit_after', p_amount, 'memberships_touched', 0,
      'note', 'Nothing is owing on this membership — the full amount would be held as credit.');
  END IF;

  v_ref := 'PREVIEW-' || gen_random_uuid()::text;

  BEGIN
    INSERT INTO transactions (member_id, type, amount, reference, status, related_id, description)
    VALUES (v_member, 'contribution', p_amount, v_ref, 'pending', v_target, 'preview');

    PERFORM settle_payment(v_ref, p_amount, v_scope, p_as_of);

    SELECT jsonb_build_object(
      'amount', p_amount,
      'as_of',  p_as_of,
      'scope',  v_scope,
      'covers', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'contribution_id', pa.contribution_id,
                 'membership_id',   pa.membership_id,
                 'group_name',      pa.group_name,
                 'due_date',        pa.due_date,
                 'amount',          pa.amount,
                 'kind',            pa.kind,
                 'remaining_after', GREATEST(c.amount + COALESCE(c.penalty_due,0) - c.amount_paid, 0))
               ORDER BY pa.due_date, pa.group_name)
        FROM payment_allocations pa
        JOIN contributions c ON c.id = pa.contribution_id
        WHERE pa.reference = v_ref), '[]'::jsonb),
      'days_fully_covered',  (SELECT count(*) FROM payment_allocations WHERE reference = v_ref AND kind='full'),
      'days_partly_covered', (SELECT count(*) FROM payment_allocations WHERE reference = v_ref AND kind='part'),
      'total_allocated',     COALESCE((SELECT sum(amount) FROM payment_allocations WHERE reference = v_ref), 0),
      'credit_after',        COALESCE((SELECT sum(l.amount) FROM membership_credit_ledger l
                                       WHERE l.membership_id = p_membership_id), 0),
      'memberships_touched', (SELECT count(DISTINCT membership_id) FROM payment_allocations WHERE reference = v_ref)
    ) INTO v_result;

    RAISE EXCEPTION 'PREVIEW_ROLLBACK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'PREVIEW_ROLLBACK' THEN
      RAISE;   -- a real failure must surface, not masquerade as an empty preview
    END IF;
  END;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION preview_payment_for_membership(UUID, DECIMAL, BOOLEAN, DATE) IS
  'What an as-yet-unmade payment would cover. Constructs the payment inside a '
  'savepoint, runs the REAL settle_payment() against it, and rolls back — so '
  'the preview cannot diverge from the settlement. Caller must authorize the '
  'membership against the session member.';

REVOKE ALL ON FUNCTION preview_payment_for_membership(UUID, DECIMAL, BOOLEAN, DATE) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION preview_payment_for_membership(UUID,DECIMAL,BOOLEAN,DATE) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION preview_payment_for_membership(UUID,DECIMAL,BOOLEAN,DATE) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION preview_payment_for_membership(UUID,DECIMAL,BOOLEAN,DATE) TO service_role';
  END IF;
END $$;

COMMIT;
