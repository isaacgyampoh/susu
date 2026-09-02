-- ============================================================================
-- v47 — A SETTLED DAY MUST NOT REPORT A BALANCE
-- ============================================================================
-- `get_member_statement()` built each day's line as:
--
--     remaining = amount + penalty - amount_paid
--
-- `contributions.amount_paid` is a later addition and only the current engine
-- populates it. 2,895 settled days carry status='paid' with amount_paid = 0 —
-- the legacy blanket UPDATE marked days paid without recording an amount
-- against them. The subtraction therefore reports the full contribution as
-- still owed on a day that was settled months ago.
--
-- Across production that is 3,007 days showing GHS 227,190.50 of debt that
-- nobody owes, on the one screen a member opens to check what they have paid.
--
-- ── THIS IS NOT A CHANGE OF FINANCIAL RULE ──────────────────────────────────
--
-- `status` is already the authority on whether a day is settled, and this same
-- function already relies on it everywhere else: `settled`, `closing_outstanding`
-- and `prepaid_before_period` all key on `paid_at`/status rather than on
-- amount_paid. The per-day line was the one place that did not, which made the
-- statement disagree with its own totals.
--
-- The financial invariants take the same view: `allocation_against_unsettled_day`
-- flags a row only when status <> 'paid' AND amount_paid is 0, treating this
-- shape as legitimate history rather than a violation.
--
-- Nothing is settled, unsettled, credited or moved by this migration. It reads
-- the authoritative column. No row is written.
--
-- ── WHAT IS DELIBERATELY NOT FIXED HERE ─────────────────────────────────────
--
-- `total_paid_ever` in this function, and `paid_all_time` in
-- get_member_portal_state(), both SUM(amount_paid) and are understated by the
-- same gap — GHS 224,840.50 platform-wide. That is a headline figure a member
-- reads as "what I have put in", and moving it is the owner's call, not a
-- side effect of a UI pass. It is reported rather than changed.
-- ============================================================================

DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_member_statement';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'get_member_statement() not found';
  END IF;

  -- A settled day owes nothing. An unsettled day owes what is not yet covered.
  v_def := replace(
    v_def,
    '''remaining'',   GREATEST(c.amount + COALESCE(c.penalty_due,0) - c.amount_paid, 0),',
    '''remaining'',   CASE WHEN c.status = ''paid'' THEN 0'
    || ' ELSE GREATEST(c.amount + COALESCE(c.penalty_due,0) - COALESCE(c.amount_paid,0), 0) END,'
  );

  IF v_def NOT LIKE '%CASE WHEN c.status = ''paid'' THEN 0%' THEN
    RAISE EXCEPTION 'remaining expression not found — the function has changed shape; review before rerunning';
  END IF;

  EXECUTE v_def;
END $$;
