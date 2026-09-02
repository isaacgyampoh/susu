-- ============================================================================
-- V34 — MEMBER STATEMENTS  (Phase 06)
-- ============================================================================
-- A statement per membership, over a date range, aggregated in the database.
--
-- ── WHAT THE DATA CAN AND CANNOT SUPPORT ─────────────────────────────────
-- Measured before designing this, not assumed:
--
--   contributions marked paid ............................ 5,627
--   with an allocation record (which payment covered them)   164
--   paid with NO allocation record ....................... 5,464
--   allocation history begins ....................... 24 Jul 2026
--   obligations begin ............................... 23 May 2026
--
-- So payment ATTRIBUTION — "this GHS 450 covered these five days" — only
-- exists from 24 July onward, because four of the five legacy settlement paths
-- never wrote an allocation row.
--
-- OBLIGATION accounting, however, is complete for all history:
-- contributions.due_date and .paid_at exist on every row. So the statement is
-- built on those, and payment attribution is added where it exists.
--
-- The alternative — reconstructing attribution by matching amounts and dates —
-- would be inference presented as fact across GHS 400,000 of history. The
-- statement instead reports `attribution_complete: false` for any period that
-- predates the allocation ledger, and says so on its face.
--
-- ── THE IDENTITY ─────────────────────────────────────────────────────────
--   opening_outstanding + fell_due − settled − covered_in_advance
--       = closing_outstanding
--
-- `covered_in_advance` is days that fell due in the period but were already
-- paid before it began. Omitting that term is what made 13 of 291 statements
-- fail to balance on the first attempt.
--
-- Checked by the function itself and returned as `reconciles`. A statement
-- that does not balance says so rather than quietly rounding.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS get_member_statement(UUID, DATE, DATE, UUID);

CREATE FUNCTION get_member_statement(
  p_member_id     UUID,
  p_from          DATE,
  p_to            DATE,
  p_membership_id UUID DEFAULT NULL   -- NULL = every membership, listed separately
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result JSONB;
BEGIN
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'A statement needs a valid date range' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Bounded server-side. A client cannot request an unbounded range.
  IF p_to - p_from > 400 THEN
    RAISE EXCEPTION 'A statement covers at most 400 days' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  WITH ms AS (
    SELECT gm.id, gm.group_id, gm.payout_position, gm.payout_date, gm.payout_amount,
           gm.payout_received, gm.slot_fraction, g.name AS group_name,
           g.contribution_amount, g.contribution_frequency, g.cashout_amount
    FROM group_memberships gm
    JOIN susu_groups g ON g.id = gm.group_id
    WHERE gm.member_id = p_member_id
      AND gm.status = 'active'
      AND (p_membership_id IS NULL OR gm.id = p_membership_id)
  ),
  -- Obligations, positioned relative to the period.
  obl AS (
    SELECT c.membership_id,
           -- Had fallen due before the period and was still unsettled at its start.
           SUM(c.amount + COALESCE(c.penalty_due,0)) FILTER (
             WHERE c.due_date < p_from
               AND (c.paid_at IS NULL OR c.paid_at::date >= p_from))            AS opening_outstanding,
           -- Penalty included consistently with opening and settled, or the
           -- identity cannot balance.
           SUM(c.amount + COALESCE(c.penalty_due,0)) FILTER (
             WHERE c.due_date BETWEEN p_from AND p_to)                          AS fell_due,
           COUNT(*)     FILTER (WHERE c.due_date BETWEEN p_from AND p_to)       AS days_fell_due,
           -- Restricted to obligations due by p_to: a day settled in advance
           -- (due after the period) is not a movement against this period's
           -- opening balance, and counting it broke the identity.
           SUM(c.amount + COALESCE(c.penalty_due,0)) FILTER (
             WHERE c.due_date <= p_to
               AND c.paid_at::date BETWEEN p_from AND p_to)                     AS settled,
           COUNT(*)     FILTER (WHERE c.due_date <= p_to
               AND c.paid_at::date BETWEEN p_from AND p_to)                     AS days_settled,
           -- POINT IN TIME, as at p_to — not current status. A day settled
           -- AFTER the period was still outstanding at its close, and using
           -- `status <> 'paid'` silently dropped those rows.
           SUM(c.amount + COALESCE(c.penalty_due,0)) FILTER (
             WHERE c.due_date <= p_to
               AND (c.paid_at IS NULL OR c.paid_at::date > p_to))               AS closing_outstanding,
           -- Days that fell due IN this period but had ALREADY been settled
           -- before it began — the member paid them in advance. They appear in
           -- fell_due, but in neither `settled` (settled outside the window)
           -- nor `closing` (already paid), so without this term the identity
           -- breaks by exactly the advance amount. This is the advance-payment
           -- feature showing up in the accounting, not an error.
           SUM(c.amount + COALESCE(c.penalty_due,0)) FILTER (
             WHERE c.due_date BETWEEN p_from AND p_to
               AND c.paid_at IS NOT NULL AND c.paid_at::date < p_from)          AS prepaid_before_period,
           COUNT(*) FILTER (
             WHERE c.due_date BETWEEN p_from AND p_to
               AND c.paid_at IS NOT NULL AND c.paid_at::date < p_from)          AS days_prepaid_before,
           -- Part payments are shown separately rather than folded into the
           -- identity: amount_paid is a CURRENT value with no history, so it
           -- cannot honestly be stated as at a past date.
           SUM(c.amount_paid) FILTER (
             WHERE c.due_date <= p_to
               AND (c.paid_at IS NULL OR c.paid_at::date > p_to))               AS partially_applied,
           -- Money against days not yet due: paid in advance.
           SUM(c.amount_paid) FILTER (WHERE c.due_date > p_to)                  AS paid_in_advance,
           SUM(c.amount)                                                        AS total_expected,
           SUM(c.amount_paid)                                                   AS total_paid_ever
    FROM contributions c
    WHERE c.member_id = p_member_id
      AND (p_membership_id IS NULL OR c.membership_id = p_membership_id)
    GROUP BY c.membership_id
  ),
  -- Day-by-day lines within the period.
  lines AS (
    SELECT c.membership_id,
           jsonb_agg(jsonb_build_object(
             'due_date',    c.due_date,
             'amount',      c.amount,
             'penalty',     COALESCE(c.penalty_due,0),
             'amount_paid', c.amount_paid,
             'remaining',   GREATEST(c.amount + COALESCE(c.penalty_due,0) - c.amount_paid, 0),
             'status',      c.status,
             'settled_on',  c.paid_at::date,
             'method',      c.payment_method,
             -- Present only where the allocation ledger recorded it.
             'paid_by',     (SELECT jsonb_agg(jsonb_build_object(
                                'reference', pa.reference, 'amount', pa.amount, 'kind', pa.kind)
                              ORDER BY pa.created_at)
                             FROM payment_allocations pa WHERE pa.contribution_id = c.id)
           ) ORDER BY c.due_date) AS entries
    FROM contributions c
    WHERE c.member_id = p_member_id
      AND (p_membership_id IS NULL OR c.membership_id = p_membership_id)
      AND c.due_date BETWEEN p_from AND p_to
    GROUP BY c.membership_id
  ),
  -- Payments that touched each membership in the period.
  pays AS (
    SELECT pa.membership_id,
           jsonb_agg(x ORDER BY x->>'at' DESC) AS payments,
           SUM((x->>'applied')::numeric)       AS total_applied
    FROM (
      SELECT pa2.membership_id, pa2.reference,
             jsonb_build_object(
               'reference', pa2.reference,
               'at',        min(pa2.created_at),
               'applied',   sum(pa2.amount),
               'days',      count(*),
               'purpose',   'contribution'
             ) AS x
      FROM payment_allocations pa2
      WHERE pa2.member_id = p_member_id
        AND (p_membership_id IS NULL OR pa2.membership_id = p_membership_id)
        AND pa2.created_at::date BETWEEN p_from AND p_to
      GROUP BY pa2.membership_id, pa2.reference
    ) pa
    GROUP BY pa.membership_id
  ),
  -- Credit movements are fully historical: the ledger is append-only.
  cred AS (
    SELECT l.membership_id,
           SUM(l.amount) FILTER (WHERE l.created_at::date <  p_from)              AS opening_credit,
           SUM(l.amount) FILTER (WHERE l.created_at::date <= p_to)                AS closing_credit,
           jsonb_agg(jsonb_build_object(
             'at', l.created_at, 'amount', l.amount, 'type', l.entry_type,
             'note', l.note, 'reference', l.source_reference)
             ORDER BY l.created_at) FILTER (WHERE l.created_at::date BETWEEN p_from AND p_to) AS movements
    FROM membership_credit_ledger l
    WHERE l.member_id = p_member_id
      AND (p_membership_id IS NULL OR l.membership_id = p_membership_id)
    GROUP BY l.membership_id
  ),
  payouts_in AS (
    SELECT p.membership_id,
           jsonb_agg(jsonb_build_object(
             'scheduled_date', p.scheduled_date, 'amount', p.total_amount,
             'status', p.status, 'paid_at', p.paid_at) ORDER BY p.scheduled_date) AS payouts
    FROM payouts p
    WHERE p.member_id = p_member_id
      AND (p_membership_id IS NULL OR p.membership_id = p_membership_id)
    GROUP BY p.membership_id
  )
  SELECT jsonb_build_object(
    'member', (SELECT jsonb_build_object('id', m.id, 'member_code', m.member_id,
                        'full_name', m.full_name, 'phone', m.phone)
               FROM members m WHERE m.id = p_member_id),
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'days', p_to - p_from + 1),
    'generated_at', now(),
    -- Payment attribution only exists from the day the allocation ledger began.
    'attribution_complete', p_from >= DATE '2026-07-24',
    'attribution_note', CASE WHEN p_from >= DATE '2026-07-24' THEN NULL ELSE
      'Payments before 24 July 2026 were recorded without an allocation ledger, '
      'so this statement shows when each day was settled but not which payment '
      'settled it. Obligation totals are complete for the whole period.' END,
    'memberships', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'membership_id',    ms.id,
        'group_name',       ms.group_name,
        'contribution',     ROUND(ms.contribution_amount * COALESCE(ms.slot_fraction,1), 2),
        'frequency',        ms.contribution_frequency,
        'slot_fraction',    ms.slot_fraction,
        'payout_position',  ms.payout_position,
        'cash_out_date',    ms.payout_date,
        'payout_amount',    COALESCE(ms.payout_amount,
                              ROUND(ms.cashout_amount * COALESCE(ms.slot_fraction,1), 2)),
        'payout_received',  ms.payout_received,
        'opening', jsonb_build_object(
          'outstanding', COALESCE(o.opening_outstanding,0),
          'credit',      COALESCE(cr.opening_credit,0)),
        'movements', jsonb_build_object(
          'fell_due',     COALESCE(o.fell_due,0),
          'days_fell_due',COALESCE(o.days_fell_due,0),
          'settled',      COALESCE(o.settled,0),
          'days_settled', COALESCE(o.days_settled,0),
          -- Days in this period the member had already paid for beforehand.
          'covered_in_advance',      COALESCE(o.prepaid_before_period,0),
          'days_covered_in_advance', COALESCE(o.days_prepaid_before,0),
          'payments_applied', COALESCE(pz.total_applied,0)),
        'closing', jsonb_build_object(
          'outstanding',       COALESCE(o.closing_outstanding,0),
          'credit',            COALESCE(cr.closing_credit,0),
          'paid_in_advance',   COALESCE(o.paid_in_advance,0),
          -- Money already applied to still-open days. Reduces what is owed,
          -- but is not part of the period identity — see the comment above.
          'partially_applied', COALESCE(o.partially_applied,0)),
        'lifetime', jsonb_build_object(
          'total_expected', COALESCE(o.total_expected,0),
          'total_paid',     COALESCE(o.total_paid_ever,0)),
        -- opening + fell_due − settled should equal closing.
        -- opening + fell_due − settled − covered_in_advance = closing
        'reconciles', abs(
            (COALESCE(o.opening_outstanding,0) + COALESCE(o.fell_due,0)
             - COALESCE(o.settled,0) - COALESCE(o.prepaid_before_period,0))
            - COALESCE(o.closing_outstanding,0)) < 0.005,
        'entries',        COALESCE(l.entries, '[]'::jsonb),
        'payments',       COALESCE(pz.payments, '[]'::jsonb),
        'credit_movements', COALESCE(cr.movements, '[]'::jsonb),
        'payouts',        COALESCE(po.payouts, '[]'::jsonb))
      ORDER BY ms.group_name)
      FROM ms
      LEFT JOIN obl        o  ON o.membership_id  = ms.id
      LEFT JOIN lines      l  ON l.membership_id  = ms.id
      LEFT JOIN pays       pz ON pz.membership_id = ms.id
      LEFT JOIN cred       cr ON cr.membership_id = ms.id
      LEFT JOIN payouts_in po ON po.membership_id = ms.id), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION get_member_statement(UUID, DATE, DATE, UUID) IS
  'Per-membership statement over a date range, aggregated in the database. '
  'Reports attribution_complete=false for periods predating the allocation '
  'ledger rather than inferring which payment covered which day.';

REVOKE ALL ON FUNCTION get_member_statement(UUID, DATE, DATE, UUID) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION get_member_statement(UUID,DATE,DATE,UUID) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION get_member_statement(UUID,DATE,DATE,UUID) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION get_member_statement(UUID,DATE,DATE,UUID) TO service_role';
  END IF;
END $$;

COMMIT;
