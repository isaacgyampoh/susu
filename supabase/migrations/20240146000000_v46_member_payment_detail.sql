-- ============================================================================
-- v46 — ONE PAYMENT, AS THE MEMBER WHO MADE IT
-- ============================================================================
-- The member portal could list payments and say what each one covered, but had
-- nowhere to send somebody who tapped one. "Contribution payment — GHS 450" is
-- not an answer to "what happened to my money".
--
-- ── SCOPING IS THE WHOLE SECURITY STORY ─────────────────────────────────────
--
-- `p_member_id` comes from the caller's verified session token, never from the
-- browser, and it appears in the WHERE clause rather than in a check afterwards:
--
--     WHERE t.reference = p_reference AND t.member_id = p_member_id
--
-- So a reference belonging to somebody else does not return a filtered row, it
-- returns no row at all, and the function answers NULL. There is no version of
-- this query that reads another member's payment, which is a stronger guarantee
-- than fetching first and comparing ids after.
--
-- ── NOTHING IS RECONSTRUCTED ────────────────────────────────────────────────
--
-- Allocations are read from the ledger exactly as recorded: the days a payment
-- settled, in the order it settled them, at the amounts it applied. Days are not
-- assumed contiguous, amounts are not divided out of the total, and the group is
-- not inferred from the member. A payment that settled days 2, 5 and 9 returns
-- days 2, 5 and 9.
--
-- ── WHY "REMAINING" IS NOT obligation - amount_paid ─────────────────────────
--
-- `contributions.amount_paid` is a later addition and is only populated by the
-- current engine. Thousands of historical days carry status='paid' with
-- amount_paid = 0 — the legacy blanket UPDATE marked days paid without ever
-- recording an amount against them (2,486 of August's settled days alone).
--
-- Subtracting that field from the obligation would therefore tell a member they
-- still owe GHS 77 on a day that was paid in full months ago. Showing somebody a
-- debt they do not have is the worst thing this screen could do.
--
-- So `status` decides whether a day is settled, and `amount_paid` only refines
-- how much of an UNSETTLED day is covered. That is the same rule the financial
-- invariants already use: `allocation_against_unsettled_day` flags a row only
-- when status <> 'paid' AND amount_paid is 0, which is to say it treats
-- status='paid' with amount_paid = 0 as a legitimate historical shape rather
-- than a violation.
--
-- No financial logic is changed here. This reads the authoritative field
-- instead of a field that is historically incomplete.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_member_payment(p_member_id uuid, p_reference text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  WITH t AS (
    SELECT tr.*, tr.status::text AS status_t, tr.type::text AS type_t
    FROM transactions tr
    WHERE tr.reference = p_reference
      AND tr.member_id = p_member_id      -- the scope, not an afterthought
  ),
  alloc AS (
    SELECT pa.*, c.amount AS obligation, c.amount_paid, c.status::text AS c_status
    FROM payment_allocations pa
    JOIN t ON t.reference = pa.reference
    LEFT JOIN contributions c ON c.id = pa.contribution_id
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM t) THEN NULL ELSE jsonb_build_object(

    'payment', (SELECT jsonb_build_object(
        'reference', t.reference,
        'amount',    t.amount,
        'status',    t.status_t,
        'type',      t.type_t,
        'created_at', t.created_at,
        -- NaloPay is the only provider; a payment with no provider order was
        -- collected by an administrator in cash or MoMo.
        'method', CASE WHEN t.paystack_data ->> 'provider_order_id' IS NOT NULL
                       THEN 'NaloPay' ELSE 'Collected by your admin' END,
        'scope', t.paystack_data ->> 'scope'
      ) FROM t),

    -- Grouped by group, because that is how a member holds their money. Days
    -- keep the ledger's own order within each group.
    'groups', COALESCE((
      SELECT jsonb_agg(g ORDER BY g->>'group_name')
      FROM (
        SELECT jsonb_build_object(
          'group_name', a.group_name,
          'membership_id', a.membership_id,
          'allocated', sum(a.amount) FILTER (WHERE a.reversed_at IS NULL),
          'days', jsonb_agg(jsonb_build_object(
                    'due_date',   a.due_date,
                    'amount',     a.amount,
                    'kind',       a.kind,
                    'obligation', a.obligation,
                    -- `status` is the authority on whether a day is settled;
                    -- `amount_paid` only refines a partial. See the note below.
                    'settled',    (a.c_status = 'paid'),
                    'remaining',  CASE WHEN a.c_status = 'paid' THEN 0
                                       ELSE GREATEST(0, COALESCE(a.obligation,0) - COALESCE(a.amount_paid,0))
                                  END,
                    'reversed_at', a.reversed_at)
                  ORDER BY a.due_date)
        ) AS g
        FROM alloc a
        GROUP BY a.group_name, a.membership_id
      ) x), '[]'::jsonb),

    'totals', (SELECT jsonb_build_object(
        'allocated', COALESCE(sum(a.amount) FILTER (WHERE a.reversed_at IS NULL), 0),
        'reversed',  COALESCE(sum(a.amount) FILTER (WHERE a.reversed_at IS NOT NULL), 0),
        'days',      count(*) FILTER (WHERE a.reversed_at IS NULL),
        -- Days this payment only part-covered: what a member needs to see when
        -- a payment succeeded but did not clear the obligation.
        'part_days', count(*) FILTER (WHERE a.reversed_at IS NULL
                                        AND a.c_status <> 'paid'
                                        AND COALESCE(a.obligation,0) - COALESCE(a.amount_paid,0) > 0.005)
      ) FROM alloc a),

    -- Surplus held against the membership. Reported by the engine's own log,
    -- never derived by subtracting allocations from the payment.
    'credit_banked', COALESCE((
      SELECT sum(sl.credit_banked) FROM settlement_log sl
      JOIN t ON t.reference = sl.reference
      WHERE sl.event = 'settlement_completed'), 0),

    'settled_at', (SELECT max(sl.created_at) FROM settlement_log sl
                   JOIN t ON t.reference = sl.reference
                   WHERE sl.event = 'settlement_completed')
  ) END;
$fn$;

REVOKE ALL ON FUNCTION get_member_payment(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_member_payment(uuid, text) TO service_role;
