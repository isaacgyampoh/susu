-- ============================================================================
-- v48 — ONE RULE FOR "HOW MUCH HAS ACTUALLY BEEN PAID"
-- ============================================================================
-- WRITES NO FINANCIAL ROWS. This migration creates one function and replaces
-- the bodies of three reporting functions. No INSERT, UPDATE or DELETE touches
-- contributions, transactions, payment_allocations or any ledger.
--
-- ── THE PROBLEM ─────────────────────────────────────────────────────────────
--
-- Member-facing lifetime "paid" was SUM(contributions.amount_paid). That column
-- is a later addition which only the current engine populates: 2,895 settled
-- days carry status='paid' with amount_paid = 0, left by the legacy blanket
-- UPDATE that marked days paid without recording an amount.
--
-- So the home screen understated what members had contributed by
-- GHS 224,840.50 platform-wide. Worse, the SAME function computed
-- `total_outstanding` with FILTER (status <> 'paid') — status-aware and
-- correct — so "paid so far" and "still owed" were derived from two different
-- notions of settlement and could never reconcile. That is why paid appeared
-- smaller than owed on a member who had paid most of their obligations.
--
-- ── THE RULE ────────────────────────────────────────────────────────────────
--
-- Settlement status is authoritative for WHETHER a day is settled.
-- `amount_paid` refines HOW MUCH of an UNSETTLED day is covered.
--
--     settled day    -> the day's own obligation
--     unsettled day  -> whatever has been part-paid against it
--
-- This is not a new accounting model; it is the rule the rest of the system
-- already uses. `get_admin_totals` computes outstanding as
-- SUM(amount - amount_paid) FILTER (status <> 'paid'), and the financial
-- invariant `allocation_against_unsettled_day` flags a row only when
-- status <> 'paid' AND amount_paid is 0 — both treat status as the authority
-- and this historical shape as legitimate.
--
-- ── WHAT IT DELIBERATELY IS NOT ─────────────────────────────────────────────
--
--   NOT SUM(amount) over everything. That would count unpaid obligations as
--   paid — the opposite error, and a far more damaging one.
--
--   NOT the payment or allocation ledger. Only ~734 of 6,195 settled days have
--   allocation rows; the ledger postdates most of this history, so summing it
--   would understate far worse than the bug being fixed.
--
--   NOT a balance. Credit is not added (it lives in
--   membership_credit_ledger and has not discharged an obligation), payouts are
--   not subtracted, and registration fees are not included — this reads the
--   contributions table only, exactly as the metric always did.
--
--   NOT double counted. One contribution row contributes once, whether one
--   payment settled it or five.
-- ============================================================================

CREATE OR REPLACE FUNCTION contribution_settled_amount(
  p_status      text,
  p_amount      numeric,
  p_amount_paid numeric
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_status = 'paid' THEN COALESCE(p_amount, 0)
    ELSE LEAST(COALESCE(p_amount_paid, 0), COALESCE(p_amount, 0))
  END;
$$;

COMMENT ON FUNCTION contribution_settled_amount(text, numeric, numeric) IS
  'How much of one contribution day has actually been settled. Status decides '
  'whether the day is discharged; amount_paid only refines an unsettled day. '
  'Never exceeds the obligation. Excludes credit, payouts and registration fees.';

GRANT EXECUTE ON FUNCTION contribution_settled_amount(text, numeric, numeric)
  TO service_role, authenticated, anon;


-- ── Apply it to the three reporting expressions that were wrong ─────────────
-- Each replacement is asserted: if the surrounding function has changed shape,
-- the migration raises rather than silently leaving the defect in place.
DO $$
DECLARE
  v_def text;
  v_before text;
BEGIN
  -- 1. Member home: `paid_all_time` and each membership's `total_paid`.
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='get_member_portal_state';
  v_before := v_def;

  v_def := replace(v_def,
    'SUM(c.amount_paid)                                               AS total_paid,',
    'SUM(contribution_settled_amount(c.status::text, c.amount, c.amount_paid)) AS total_paid,');

  v_def := replace(v_def,
    'SUM(c.amount_paid) FILTER (WHERE c.due_date = p_as_of)           AS paid_today,',
    'SUM(contribution_settled_amount(c.status::text, c.amount, c.amount_paid)) FILTER (WHERE c.due_date = p_as_of) AS paid_today,');

  v_def := replace(v_def,
    'SUM(c.amount_paid) FILTER (WHERE c.due_date > p_as_of)           AS paid_in_advance,',
    'SUM(contribution_settled_amount(c.status::text, c.amount, c.amount_paid)) FILTER (WHERE c.due_date > p_as_of) AS paid_in_advance,');

  IF v_def = v_before THEN
    RAISE EXCEPTION 'get_member_portal_state: no expression matched — review before rerunning';
  END IF;
  EXECUTE v_def;

  -- 2. Statement: lifetime paid.
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='get_member_statement';
  v_before := v_def;

  v_def := replace(v_def,
    'SUM(c.amount_paid)                                                   AS total_paid_ever',
    'SUM(contribution_settled_amount(c.status::text, c.amount, c.amount_paid)) AS total_paid_ever');

  v_def := replace(v_def,
    'SUM(c.amount_paid) FILTER (WHERE c.due_date > p_to)                  AS paid_in_advance,',
    'SUM(contribution_settled_amount(c.status::text, c.amount, c.amount_paid)) FILTER (WHERE c.due_date > p_to) AS paid_in_advance,');

  IF v_def = v_before THEN
    RAISE EXCEPTION 'get_member_statement: no expression matched — review before rerunning';
  END IF;
  EXECUTE v_def;

  -- 3. Admin reconciliation queue: what a member has contributed.
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname='public' AND p.proname='get_reconciliation_queue';
  v_before := v_def;

  v_def := replace(v_def,
    'sum(c.amount_paid)',
    'sum(contribution_settled_amount(c.status::text, c.amount, c.amount_paid))');

  IF v_def = v_before THEN
    RAISE EXCEPTION 'get_reconciliation_queue: no expression matched — review before rerunning';
  END IF;
  EXECUTE v_def;
END $$;
