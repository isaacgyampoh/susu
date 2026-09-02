-- ============================================================================
-- v45 — THE PAYMENTS WORKSPACE, ANSWERED BY THE DATABASE
-- ============================================================================
-- Two functions, one per screen, matching how every other console screen is
-- already served (get_member_portal_state, get_admin_totals,
-- get_reconciliation_queue). The alternative — a list endpoint plus a detail
-- endpoint plus an allocations endpoint — is where N+1 queries come from.
--
-- ── WHY THIS REPLACES FILTERING IN THE EDGE FUNCTION ────────────────────────
--
-- `admin-transactions` paginated FIRST and then filtered the page in
-- JavaScript:
--
--     const filtered = channel === 'all' ? rows : rows.filter(...)
--
-- So "manual payments, page 1" returned however many of the newest 50 payments
-- happened to be manual — sometimes three rows, with the pager insisting there
-- were more pages. The count was the count of the UNFILTERED query. Filtering
-- after paging cannot be made correct in the client; it has to happen where the
-- rows are chosen.
--
-- ── GROUP CONTEXT IS TAKEN FROM ALLOCATIONS, NEVER FROM THE MEMBER ──────────
--
-- A member may belong to several groups, so "which group was this payment for"
-- is not a property of the member. It is a property of what the payment
-- SETTLED. Both functions read group and membership from `payment_allocations`,
-- which records the membership each cedi landed against. There is no
-- `members.group_id` here, no `memberships[0]`, and no LIMIT 1.
--
-- A pending payment has no allocations yet, and therefore has no group. That is
-- the truth and the UI says so, rather than guessing one.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_payments_workspace(
  p_status  text    DEFAULT 'all',
  p_channel text    DEFAULT 'all',
  p_from    date    DEFAULT NULL,
  p_to      date    DEFAULT NULL,
  p_group   uuid    DEFAULT NULL,
  p_search  text    DEFAULT NULL,
  p_min     numeric DEFAULT NULL,
  p_max     numeric DEFAULT NULL,
  p_page    integer DEFAULT 1,
  p_size    integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  -- One filtered set, reused for the page, the count and the totals — so the
  -- summary can never describe a different population than the rows shown.
  WITH args AS (
    SELECT LEAST(GREATEST(COALESCE(p_size, 25), 1), 100) AS size,
           GREATEST(COALESCE(p_page, 1), 1)              AS page,
           NULLIF(btrim(COALESCE(p_search, '')), '')     AS q
  ),
  base AS (
    SELECT
      -- status/type are enums (tx_status). Cast once, here, so every
      -- comparison and aggregate downstream operates on text.
      t.id, t.reference, t.amount, t.status::text AS status, t.type::text AS type,
      t.created_at,
      (t.paystack_data ->> 'provider_order_id') AS order_id,
      CASE WHEN t.paystack_data ->> 'provider_order_id' IS NOT NULL
           THEN 'online' ELSE 'manual' END      AS channel,
      m.id AS member_id, m.full_name AS member_name,
      m.member_id AS member_code, m.phone AS member_phone
    FROM transactions t
    LEFT JOIN members m ON m.id = t.member_id
    CROSS JOIN args
    WHERE t.type::text IN ('contribution', 'registration_fee')
      AND (p_status  = 'all' OR t.status::text = p_status)
      AND (p_channel = 'all'
           OR (p_channel = 'online' AND t.paystack_data ->> 'provider_order_id' IS NOT NULL)
           OR (p_channel = 'manual' AND t.paystack_data ->> 'provider_order_id' IS NULL))
      AND (p_from IS NULL OR t.created_at >= p_from::timestamptz)
      AND (p_to   IS NULL OR t.created_at <  (p_to + 1)::timestamptz)
      AND (p_min  IS NULL OR t.amount >= p_min)
      AND (p_max  IS NULL OR t.amount <= p_max)
      -- Group is a property of what the payment SETTLED, not of the member.
      AND (p_group IS NULL OR EXISTS (
            SELECT 1 FROM payment_allocations pa
             WHERE pa.reference = t.reference AND pa.group_id = p_group))
      -- Parameterised. User text is never concatenated into executable SQL.
      AND (args.q IS NULL
           OR m.full_name ILIKE '%' || args.q || '%'
           OR m.phone     ILIKE '%' || args.q || '%'
           OR m.member_id ILIKE '%' || args.q || '%'
           OR t.reference ILIKE '%' || args.q || '%'
           OR t.paystack_data ->> 'provider_order_id' ILIKE '%' || args.q || '%')
  ),
  summary AS (
    SELECT jsonb_build_object(
      'count',     count(*),
      'collected', COALESCE(sum(amount) FILTER (WHERE status = 'success'), 0),
      'pending',   COALESCE(sum(amount) FILTER (WHERE status = 'pending'), 0),
      'failed',    COALESCE(sum(amount) FILTER (WHERE status = 'failed'),  0),
      'n_success', count(*) FILTER (WHERE status = 'success'),
      'n_pending', count(*) FILTER (WHERE status = 'pending'),
      'n_failed',  count(*) FILTER (WHERE status = 'failed')
    ) AS s, count(*) AS total
    FROM base
  ),
  page AS (
    SELECT b.created_at, jsonb_build_object(
      'id', b.id, 'reference', b.reference, 'amount', b.amount,
      'status', b.status, 'type', b.type, 'channel', b.channel,
      'order_id', b.order_id, 'created_at', b.created_at,
      'member', CASE WHEN b.member_id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', b.member_id, 'name', b.member_name,
        'code', b.member_code, 'phone', b.member_phone) END,
      -- A pending payment has settled nothing, so it has no group. That is the
      -- truth; the UI says "not yet allocated" rather than guessing one.
      'allocated', COALESCE(a.allocated, 0),
      'days',      COALESCE(a.days, 0),
      'reversed_days', COALESCE(a.reversed_days, 0),
      'groups',    COALESCE(a.groups, '[]'::jsonb),
      'first_due', a.first_due,
      'last_due',  a.last_due,
      'confirmed_at', s.confirmed_at
    ) AS r
    FROM base b
    CROSS JOIN args
    LEFT JOIN LATERAL (
      -- Live and reversed are counted separately. `tx_status` has only
      -- pending/success/failed, so "reversed" is not a transaction state that
      -- can be read off the row; it is a fact about the allocation ledger, and
      -- this is the only place it can honestly come from.
      SELECT sum(pa.amount) FILTER (WHERE pa.reversed_at IS NULL) AS allocated,
             count(*)       FILTER (WHERE pa.reversed_at IS NULL) AS days,
             count(*)       FILTER (WHERE pa.reversed_at IS NOT NULL) AS reversed_days,
             min(pa.due_date) FILTER (WHERE pa.reversed_at IS NULL) AS first_due,
             max(pa.due_date) FILTER (WHERE pa.reversed_at IS NULL) AS last_due,
             jsonb_agg(DISTINCT pa.group_name) FILTER (WHERE pa.reversed_at IS NULL) AS groups
      FROM payment_allocations pa
      WHERE pa.reference = b.reference
    ) a ON true
    LEFT JOIN LATERAL (
      SELECT max(sl.created_at) AS confirmed_at
      FROM settlement_log sl
      WHERE sl.reference = b.reference AND sl.event = 'settlement_completed'
    ) s ON true
    ORDER BY b.created_at DESC
    LIMIT (SELECT size FROM args) OFFSET ((SELECT page FROM args) - 1) * (SELECT size FROM args)
  )
  SELECT jsonb_build_object(
    'rows',    COALESCE((SELECT jsonb_agg(r ORDER BY created_at DESC) FROM page), '[]'::jsonb),
    'total',   (SELECT total FROM summary),
    'page',    (SELECT page FROM args),
    'size',    (SELECT size FROM args),
    'pages',   GREATEST(1, CEIL((SELECT total FROM summary)::numeric / (SELECT size FROM args))::int),
    'summary', (SELECT s FROM summary)
  );
$fn$;

REVOKE ALL ON FUNCTION get_payments_workspace(text,text,date,date,uuid,text,numeric,numeric,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_payments_workspace(text,text,date,date,uuid,text,numeric,numeric,integer,integer) TO service_role;


-- ============================================================================
-- ONE PAYMENT, IN FULL
-- ============================================================================
-- The section that matters is `allocations`. "Allocated: GHS 450" tells an
-- administrator nothing they can act on; what they need is which obligations
-- the money discharged, and for how much each. Every allocation therefore
-- carries the day it settled, what that day COST, what has been paid against
-- it in total, and what is still outstanding — so a partial payment is legible
-- as a partial payment rather than looking like a completed one.
--
-- `timeline` is built only from timestamps that actually exist. A pending
-- payment stops at the step it reached; nothing is interpolated, and no step
-- is given a time it does not have.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_payment_detail(p_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  WITH t AS (
    SELECT tr.*, tr.status::text AS status_t, tr.type::text AS type_t
    FROM transactions tr WHERE tr.id = p_id
  ),
  alloc AS (
    SELECT pa.*, c.amount AS obligation, c.amount_paid, c.status::text AS c_status
    FROM payment_allocations pa
    JOIN t ON t.reference = pa.reference
    LEFT JOIN contributions c ON c.id = pa.contribution_id
  ),
  log AS (
    SELECT sl.event, sl.created_at, sl.credit_banked
    FROM settlement_log sl JOIN t ON t.reference = sl.reference
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM t) THEN NULL ELSE jsonb_build_object(
    'payment', (SELECT jsonb_build_object(
        'id', t.id, 'reference', t.reference, 'amount', t.amount,
        'status', t.status_t, 'type', t.type_t, 'description', t.description,
        'created_at', t.created_at,
        'order_id', t.paystack_data ->> 'provider_order_id',
        'channel', CASE WHEN t.paystack_data ->> 'provider_order_id' IS NOT NULL
                        THEN 'online' ELSE 'manual' END,
        -- NaloPay is the only provider. Manual collections have none.
        'provider', CASE WHEN t.paystack_data ->> 'provider_order_id' IS NOT NULL
                         THEN 'NaloPay' ELSE NULL END,
        'scope', t.paystack_data ->> 'scope'
      ) FROM t),

    'member', (SELECT jsonb_build_object(
        'id', m.id, 'name', m.full_name, 'code', m.member_id,
        'phone', m.phone, 'status', m.status)
      FROM t LEFT JOIN members m ON m.id = t.member_id WHERE m.id IS NOT NULL),

    -- Memberships come from what the payment settled, so a member in four
    -- groups shows only the ones this payment actually touched.
    'memberships', COALESCE((SELECT jsonb_agg(DISTINCT jsonb_build_object(
        'membership_id', a.membership_id, 'group_id', a.group_id,
        'group_name', a.group_name)) FROM alloc a), '[]'::jsonb),

    'allocations', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'due_date', a.due_date, 'amount', a.amount, 'kind', a.kind,
        'group_name', a.group_name, 'membership_id', a.membership_id,
        'obligation', a.obligation, 'paid_total', a.amount_paid,
        'remaining', GREATEST(0, COALESCE(a.obligation,0) - COALESCE(a.amount_paid,0)),
        'contribution_status', a.c_status,
        'reversed_at', a.reversed_at, 'reversal_reason', a.reversal_reason
      ) ORDER BY a.due_date) FROM alloc a), '[]'::jsonb),

    'totals', (SELECT jsonb_build_object(
        'allocated', COALESCE(sum(a.amount) FILTER (WHERE a.reversed_at IS NULL), 0),
        'reversed',  COALESCE(sum(a.amount) FILTER (WHERE a.reversed_at IS NOT NULL), 0),
        'days',      count(*) FILTER (WHERE a.reversed_at IS NULL),
        'first_due', min(a.due_date), 'last_due', max(a.due_date)
      ) FROM alloc a),

    -- Surplus banked as credit against the membership, reported by the engine's
    -- own log rather than recomputed here.
    'credit_banked', COALESCE((SELECT sum(credit_banked) FROM log
                               WHERE event = 'settlement_completed'), 0),

    'timeline', COALESCE((
      SELECT jsonb_agg(step ORDER BY at)
      FROM (
        SELECT 'created' AS key, 'Payment recorded' AS label, t.created_at AS at,
               jsonb_build_object('key','created','label','Payment recorded','at',t.created_at) AS step
        FROM t
        UNION ALL
        SELECT 'settled', 'Settled by the engine', l.created_at,
               jsonb_build_object('key','settled','label','Settled by the engine','at',l.created_at)
        FROM log l WHERE l.event = 'settlement_completed'
        UNION ALL
        SELECT 'allocated', 'Contribution days allocated', min(a.created_at),
               jsonb_build_object('key','allocated','label','Contribution days allocated',
                                  'at',min(a.created_at),'count',count(*))
        FROM alloc a HAVING count(*) > 0
      ) s), '[]'::jsonb)
  ) END;
$fn$;

REVOKE ALL ON FUNCTION get_payment_detail(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_payment_detail(uuid) TO service_role;
