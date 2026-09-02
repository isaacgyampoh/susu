-- ============================================================================
-- v37 — REGISTRATION PAYMENT: public flow, atomic settlement, fee integrity
-- ============================================================================
-- Additive only. No table is dropped, no row is deleted, no financial value is
-- rewritten. Everything here either adds a column, adds an index, or adds a
-- function.
--
-- WHY THIS EXISTS
-- ---------------
-- A registration fee is not a contribution. It buys a place in a group; it
-- discharges no daily obligation. `settle_payment()` anchors a payment to an
-- obligation, so a registration fee cannot go through it — every
-- registration_fee row in production has related_id = NULL.
--
-- Until now registration fees were settled by TypeScript issuing three separate
-- PostgREST writes (claim the transaction, mark the application paid, log it).
-- That is the exact shape of the defect Phase 04 removed from contributions:
-- not atomic, so a crash between writes leaves a payment recorded as received
-- against an application still marked unpaid. Registration now settles the same
-- way contributions do — inside one database transaction, under a row lock.
-- ============================================================================

-- ── 1. Applicant payment token ──────────────────────────────────────────────
-- An applicant is not a member and has no login, so the link they follow to pay
-- IS their credential. Only the SHA-256 of the token is stored: a reader of this
-- table — a leaked backup, a support query, a compromised console — cannot
-- reconstruct the link and pay-page their way into someone else's application.
ALTER TABLE kyc_applications
  ADD COLUMN IF NOT EXISTS payment_token_hash       text,
  ADD COLUMN IF NOT EXISTS payment_token_issued_at  timestamptz,
  ADD COLUMN IF NOT EXISTS payment_token_expires_at timestamptz;

-- ── 2. Recording a decision about an unpaid fee, WITHOUT inventing a payment ─
-- The 13 historical unpaid registrations must stay unpaid until the business
-- decides. These columns let an administrator record what was decided and why.
-- They are deliberately separate from `registration_fee_paid`: documenting a
-- decision must never be able to masquerade as money arriving.
ALTER TABLE kyc_applications
  ADD COLUMN IF NOT EXISTS fee_resolution        text,
  ADD COLUMN IF NOT EXISTS fee_resolution_reason text,
  ADD COLUMN IF NOT EXISTS fee_resolution_by     uuid,
  ADD COLUMN IF NOT EXISTS fee_resolution_at     timestamptz;

ALTER TABLE kyc_applications
  DROP CONSTRAINT IF EXISTS kyc_fee_resolution_valid;
ALTER TABLE kyc_applications
  ADD CONSTRAINT kyc_fee_resolution_valid CHECK (
    fee_resolution IS NULL OR fee_resolution IN
      ('to_collect','waived','suspended','escalated','written_off')
  );

-- ── 3. Bind a registration payment to its application ───────────────────────
-- Pre-approval there is no member, so member_id cannot carry the link. Without
-- this column a settling callback for an applicant has nothing to mark paid.
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS kyc_application_id uuid REFERENCES kyc_applications(id);

CREATE INDEX IF NOT EXISTS idx_tx_kyc_application ON transactions(kyc_application_id)
  WHERE kyc_application_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kyc_token ON kyc_applications(payment_token_hash)
  WHERE payment_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kyc_status_submitted ON kyc_applications(status, submitted_at DESC);

-- ============================================================================
-- 4. settle_registration_fee — the registration counterpart of settle_payment
-- ============================================================================
-- Atomic, locked, idempotent, and it REFUSES A SHORT PAYMENT.
--
-- The short-payment rule is the point of this function. The previous
-- implementation computed least(confirmed, recorded) and then marked the
-- application paid with whatever that produced. A provider reporting GHS 100
-- against a GHS 150 fee therefore unlocked registration in full for two thirds
-- of the money. Here a short payment settles NOTHING: the transaction stays
-- pending, the application stays unpaid, and the discrepancy is logged for a
-- human. We do not have a representation for "partially registered", and
-- inventing one would be guessing at money.
CREATE OR REPLACE FUNCTION settle_registration_fee(
  p_reference        text,
  p_confirmed_amount numeric DEFAULT NULL
)
RETURNS TABLE (
  o_settled   boolean,
  o_already   boolean,
  o_short     boolean,
  o_applied   numeric,
  o_expected  numeric,
  o_kyc_id    uuid,
  o_member_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tx        transactions%ROWTYPE;
  v_kyc_id    uuid;
  v_expected  numeric;
  v_confirmed numeric;
  v_applied   numeric;
BEGIN
  IF p_reference IS NULL OR btrim(p_reference) = '' THEN
    RAISE EXCEPTION 'settle_registration_fee: a reference is required';
  END IF;

  -- Lock first. Two callbacks for the same payment serialise here, so the
  -- status test below cannot race.
  SELECT * INTO v_tx FROM transactions
   WHERE reference = p_reference
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'settle_registration_fee: no payment with reference %', p_reference;
  END IF;
  IF v_tx.type <> 'registration_fee' THEN
    RAISE EXCEPTION 'settle_registration_fee: % is a % payment, not a registration fee',
      p_reference, v_tx.type;
  END IF;

  -- Which application does this fee belong to? The explicit link wins; the
  -- member link is the post-approval case.
  v_kyc_id := v_tx.kyc_application_id;
  IF v_kyc_id IS NULL AND v_tx.member_id IS NOT NULL THEN
    SELECT k.id INTO v_kyc_id FROM kyc_applications k
     WHERE k.created_member_id = v_tx.member_id
     ORDER BY k.submitted_at DESC LIMIT 1;
  END IF;

  -- Replay: already settled. Return what it settled, change nothing.
  IF v_tx.status = 'success' THEN
    RETURN QUERY SELECT true, true, false,
                        v_tx.amount, v_tx.amount, v_kyc_id, v_tx.member_id;
    RETURN;
  END IF;

  -- ── Fee integrity ────────────────────────────────────────────────────────
  -- The expected fee is whatever the APPLICATION says it is — a figure the
  -- server computed from susu_groups.registration_fee at submission. It is not
  -- taken from the request, and not from the provider.
  SELECT COALESCE(k.registration_fee_amount, v_tx.amount) INTO v_expected
    FROM kyc_applications k WHERE k.id = v_kyc_id;
  v_expected := COALESCE(v_expected, v_tx.amount);

  -- With no provider figure we fall back to the recorded amount; a caller that
  -- has not verified with the provider must not reach this function at all.
  v_confirmed := COALESCE(p_confirmed_amount, v_tx.amount);

  IF v_confirmed + 0.005 < v_expected THEN
    INSERT INTO settlement_log (reference, event, member_id, amount, detail)
    VALUES (p_reference, 'registration_fee_short', v_tx.member_id, v_confirmed,
            jsonb_build_object(
              'expected', v_expected, 'confirmed', v_confirmed,
              'kyc_application_id', v_kyc_id,
              'note', 'Provider confirmed less than the registration fee. '
                   || 'Nothing settled; the application remains unpaid.'));
    RETURN QUERY SELECT false, false, true, v_confirmed, v_expected, v_kyc_id, v_tx.member_id;
    RETURN;
  END IF;

  -- Never record more than the fee, whatever the provider charged: the amount
  -- charged is grossed up by the service fee, which is not registration income.
  v_applied := LEAST(v_confirmed, v_tx.amount);

  UPDATE transactions
     SET status = 'success',
         paystack_data = COALESCE(paystack_data, '{}'::jsonb)
                       || jsonb_build_object('confirmed_amount', v_confirmed,
                                             'settled_at', now())
   WHERE id = v_tx.id;

  IF v_kyc_id IS NOT NULL THEN
    UPDATE kyc_applications
       SET registration_fee_paid = true,
           registration_fee_ref  = p_reference,
           -- The token has done its job. Retiring it here means a settled
           -- payment link cannot be replayed to start a second payment.
           payment_token_hash    = NULL,
           payment_token_expires_at = NULL
     WHERE id = v_kyc_id AND COALESCE(registration_fee_paid, false) = false;
  END IF;

  INSERT INTO settlement_log (reference, event, member_id, amount, detail)
  VALUES (p_reference, 'registration_fee_settled', v_tx.member_id, v_applied,
          jsonb_build_object('kyc_application_id', v_kyc_id,
                             'expected', v_expected, 'confirmed', v_confirmed));

  INSERT INTO audit_log (admin_id, admin_name, action, entity_type, entity_id,
                         entity_label, details)
  VALUES (NULL, 'system', 'registration.fee_settled', 'kyc_application', v_kyc_id,
          p_reference,
          jsonb_build_object('amount', v_applied, 'expected', v_expected,
                             'confirmed_by_provider', v_confirmed));

  RETURN QUERY SELECT true, false, false, v_applied, v_expected, v_kyc_id, v_tx.member_id;
END;
$$;

-- ============================================================================
-- 5. get_registration_public — what an applicant may see, and nothing more
-- ============================================================================
-- The projection is the security boundary. The caller passes a token HASH; if
-- it does not match a live, unexpired token, the function returns no rows. It
-- can therefore never be used to enumerate applications, and it never returns
-- the Ghana Card number, the uploaded document URLs, the address, the bank
-- details or the reviewer — none of which an applicant needs in order to pay.
CREATE OR REPLACE FUNCTION get_registration_public(p_token_hash text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_k        kyc_applications%ROWTYPE;
  v_groups   jsonb;
  v_pending  jsonb;
  v_ids      uuid[];
BEGIN
  IF p_token_hash IS NULL OR length(p_token_hash) <> 64 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_k FROM kyc_applications
   WHERE payment_token_hash = p_token_hash
   LIMIT 1;

  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_k.payment_token_expires_at IS NOT NULL
     AND v_k.payment_token_expires_at < now() THEN
    RETURN jsonb_build_object('expired', true);
  END IF;

  v_ids := COALESCE(v_k.selected_group_ids, ARRAY[v_k.selected_group_id]);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'name', g.name,
           'registration_fee', g.registration_fee,
           'contribution_amount', g.contribution_amount,
           'frequency', g.contribution_frequency::text,
           'slots', GREATEST(1, COALESCE((v_k.selected_slots -> g.id::text ->> 'count')::numeric, 1))
         ) ORDER BY g.name), '[]'::jsonb)
    INTO v_groups
    FROM susu_groups g WHERE g.id = ANY(v_ids);

  -- The most recent unfinished attempt, so the page can show "awaiting
  -- confirmation" instead of offering to start a second prompt.
  SELECT to_jsonb(x) INTO v_pending FROM (
    SELECT t.reference, t.amount, t.status, t.created_at
      FROM transactions t
     WHERE t.kyc_application_id = v_k.id AND t.type = 'registration_fee'
     ORDER BY t.created_at DESC LIMIT 1
  ) x;

  RETURN jsonb_build_object(
    'kyc_id',         v_k.id,
    'full_name',      v_k.full_name,
    -- Masked: enough for the applicant to recognise their own application,
    -- useless to anyone who obtained the link by accident.
    'phone_masked',   regexp_replace(v_k.phone, '^(.{4}).*(.{3})$', '\1•••••\2'),
    'groups',         v_groups,
    'fee',            COALESCE(v_k.registration_fee_amount, 0),
    'fee_paid',       COALESCE(v_k.registration_fee_paid, false),
    'status',         v_k.status::text,
    'submitted_at',   v_k.submitted_at,
    'expires_at',     v_k.payment_token_expires_at,
    'last_attempt',   v_pending
  );
END;
$$;

-- ============================================================================
-- 6. get_registration_queue — the administrative registration screen
-- ============================================================================
-- One query, whatever the number of applications. The four buckets the console
-- shows are derived here rather than in the browser, so the console cannot
-- disagree with the database about who has paid.
CREATE OR REPLACE FUNCTION get_registration_queue(p_bucket text DEFAULT 'all')
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE v_rows jsonb; v_counts jsonb;
BEGIN
  WITH base AS (
    SELECT k.*,
           CASE
             WHEN COALESCE(k.registration_fee_amount, 0) <= 0 THEN 'no_fee'
             WHEN COALESCE(k.registration_fee_paid, false)  THEN 'paid'
             WHEN EXISTS (SELECT 1 FROM transactions t
                           WHERE t.kyc_application_id = k.id
                             AND t.type = 'registration_fee'
                             AND t.status = 'pending') THEN 'awaiting_confirmation'
             ELSE 'unpaid'
           END AS payment_state
      FROM kyc_applications k
  ), bucketed AS (
    SELECT b.*,
           CASE
             WHEN b.status = 'rejected' THEN 'rejected'
             WHEN b.status = 'approved' THEN 'approved'
             WHEN b.payment_state IN ('paid','no_fee') THEN 'awaiting_review'
             ELSE 'awaiting_payment'
           END AS bucket
      FROM base b
  )
  SELECT
    COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.submitted_at DESC), '[]'::jsonb),
    (SELECT jsonb_object_agg(bucket, n) FROM (
        SELECT bucket, count(*) AS n FROM bucketed GROUP BY bucket) c)
  INTO v_rows, v_counts
  FROM (
    SELECT b.id, b.full_name, b.phone, b.email, b.submitted_at, b.reviewed_at,
           b.status::text AS status, b.bucket, b.payment_state,
           COALESCE(b.registration_fee_amount, 0) AS fee,
           COALESCE(b.registration_fee_paid, false) AS fee_paid,
           b.registration_fee_ref, b.rejection_reason,
           b.created_member_id, b.fee_resolution, b.fee_resolution_reason,
           b.fee_resolution_at,
           (b.payment_token_hash IS NOT NULL
            AND COALESCE(b.payment_token_expires_at, now()) > now()) AS has_live_link,
           b.payment_token_expires_at,
           (SELECT COALESCE(jsonb_agg(g.name ORDER BY g.name), '[]'::jsonb)
              FROM susu_groups g
             WHERE g.id = ANY(COALESCE(b.selected_group_ids, ARRAY[b.selected_group_id]))
           ) AS groups
      FROM bucketed b
     WHERE p_bucket = 'all' OR b.bucket = p_bucket
  ) r;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'counts', COALESCE(v_counts, '{}'::jsonb),
    'unpaid_approved', (
      SELECT jsonb_build_object(
        'count', count(*), 'total', COALESCE(sum(registration_fee_amount), 0))
        FROM kyc_applications
       WHERE status = 'approved'
         AND COALESCE(registration_fee_paid, false) = false
         AND COALESCE(registration_fee_amount, 0) > 0)
  );
END;
$$;

-- ── 7. Privileges. Same rule as v25: nothing financial is reachable by anon. ─
REVOKE ALL ON FUNCTION settle_registration_fee(text, numeric)  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_registration_public(text)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION get_registration_queue(text)            FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION settle_registration_fee(text, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION get_registration_public(text)          TO service_role;
GRANT EXECUTE ON FUNCTION get_registration_queue(text)           TO service_role;
