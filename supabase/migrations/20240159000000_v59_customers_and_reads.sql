-- ============================================================================
-- V59 — CUSTOMER SIGN-UP, AND EVERY SCREEN'S READ
-- ============================================================================
-- One RPC per screen, the way the rest of this system reads. A page that
-- assembles itself from four round trips is a page that shows four different
-- moments in time, and on a phone in Ghana those moments can be seconds apart.
-- ============================================================================

-- ── A BLENDER BUYER IS NOT A SUSU MEMBER ────────────────────────────────────
--
-- ghana_card_number was UNIQUE NOT NULL. That is a fair bar for somebody
-- joining a rotation — real money moves to them on their turn, and the group
-- needs to know who they are. It is the wrong bar for somebody paying off a
-- kettle: it turns a two-field sign-up into "photograph your ID", and most
-- people close the page.
--
-- So it becomes nullable. Existing members keep theirs untouched, UNIQUE still
-- holds (Postgres does not collide NULLs), and the susu joining paths still
-- collect it because they ask for it themselves. Nothing that has an ID loses
-- one; people who never needed one are no longer asked.
--
-- If the owner would rather require ID for purchases above some value, that is
-- a rule for the purchase path, not a NOT NULL on every human in the table.

ALTER TABLE members ALTER COLUMN ghana_card_number DROP NOT NULL;

-- How this person first arrived. The susu and the shop are one customer list —
-- somebody buying a fridge today may join a rotation next year, and two member
-- tables would mean two of them.
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'susu'
    CHECK (source IN ('susu','shop','admin'));

COMMENT ON COLUMN members.ghana_card_number IS
  'Required in practice for susu membership, collected by those paths. NULL is '
  'legitimate for shop customers (v59) who never join a rotation.';

-- ============================================================================
-- REGISTER A SHOP CUSTOMER
-- ============================================================================
-- Phone is the identity, as it already is for every member. If the phone is
-- already known this returns that member rather than refusing: somebody who
-- saves with the susu and then buys a television is one person, and making
-- them a second account would split their history in half.
-- ============================================================================

CREATE OR REPLACE FUNCTION register_shop_customer(
  p_full_name TEXT,
  p_phone     TEXT,
  p_passcode  TEXT,
  p_email     TEXT DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_member members%ROWTYPE;
  v_code   TEXT;
BEGIN
  IF length(btrim(COALESCE(p_full_name,''))) < 2 THEN
    RAISE EXCEPTION 'Please give your name';
  END IF;
  IF p_phone IS NULL OR length(regexp_replace(p_phone,'\D','','g')) < 9 THEN
    RAISE EXCEPTION 'Please give a valid phone number';
  END IF;
  IF p_passcode !~ '^\d{4,6}$' THEN
    RAISE EXCEPTION 'Your passcode must be 4 to 6 digits';
  END IF;

  SELECT * INTO v_member FROM members WHERE phone = p_phone;

  IF v_member.id IS NOT NULL THEN
    -- Known number. Never overwrite a passcode here: that would be a password
    -- reset through an unauthenticated endpoint, which is an account takeover.
    RETURN jsonb_build_object(
      'existing', true, 'member_id', v_member.id,
      'message', 'This number already has an account — please sign in.');
  END IF;

  SELECT 'AW-' || lpad((COALESCE(max(substring(member_id from 4)::int), 0) + 1)::text, 4, '0')
    INTO v_code FROM members WHERE member_id ~ '^AW-\d+$';

  INSERT INTO members (member_id, full_name, phone, email, passcode_hash, status, source)
  VALUES (COALESCE(v_code,'AW-0001'), btrim(p_full_name), p_phone, NULLIF(btrim(COALESCE(p_email,'')),''),
          crypt(p_passcode, gen_salt('bf')), 'active', 'shop')
  RETURNING * INTO v_member;

  RETURN jsonb_build_object('existing', false, 'member_id', v_member.id,
                            'member_code', v_member.member_id);
END $$;

REVOKE ALL ON FUNCTION register_shop_customer(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION register_shop_customer(TEXT,TEXT,TEXT,TEXT) TO service_role;

-- ============================================================================
-- THE PUBLIC CATALOGUE
-- ============================================================================
-- Published products only, with their media and live plans. Nothing about
-- stock levels beyond whether it can be bought, and nothing about who has
-- bought one.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_public_catalogue(p_slug TEXT DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'categories', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', c.id, 'name', c.name, 'slug', c.slug,
        'count', (SELECT count(*) FROM products p
                   WHERE p.category_id = c.id AND p.status = 'published')
      ) ORDER BY c.sort_order, c.name), '[]'::jsonb)
      FROM product_categories c WHERE c.is_active
    ),
    'products', (
      SELECT COALESCE(jsonb_agg(x ORDER BY x->>'sort_order', x->>'name'), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'id', p.id, 'name', p.name, 'slug', p.slug,
          'summary', p.summary, 'description', p.description,
          'specifications', p.specifications,
          'cash_price', p.cash_price,
          'sort_order', p.sort_order,
          'category', (SELECT c.name FROM product_categories c WHERE c.id = p.category_id),
          'category_slug', (SELECT c.slug FROM product_categories c WHERE c.id = p.category_id),
          'in_stock', (p.stock_quantity IS NULL OR p.stock_quantity > 0),
          'media', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'kind', m.kind, 'path', m.storage_path, 'alt', m.alt_text
            ) ORDER BY m.sort_order), '[]'::jsonb)
            FROM product_media m WHERE m.product_id = p.id),
          'plans', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'id', pl.id, 'name', pl.name, 'frequency', pl.frequency,
              'duration_count', pl.duration_count,
              'installment_amount', pl.installment_amount,
              'deposit_amount', pl.deposit_amount,
              'total_payable', pl.total_payable,
              'terms', pl.terms
            ) ORDER BY pl.sort_order, pl.total_payable), '[]'::jsonb)
            FROM payment_plans pl
            WHERE pl.product_id = p.id AND pl.is_active
              AND (pl.available_from IS NULL OR pl.available_from <= CURRENT_DATE)
              AND (pl.available_to   IS NULL OR pl.available_to   >= CURRENT_DATE))
        ) AS x
        FROM products p
        WHERE p.status = 'published'
          AND (p_slug IS NULL OR p.slug = p_slug)
      ) q
    )
  );
$$;

REVOKE ALL ON FUNCTION get_public_catalogue(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_public_catalogue(TEXT) TO service_role;

-- ============================================================================
-- A CUSTOMER'S PURCHASES
-- ============================================================================
-- §25: scoped to the caller in SQL. p_member_id comes from a verified session
-- in the edge function and nowhere else, so there is no id here for a customer
-- to change.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_member_purchases(p_member_id UUID)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH mine AS (
    SELECT p.*,
           (SELECT COALESCE(sum(i.amount_paid),0) FROM purchase_installments i
             WHERE i.purchase_id = p.id)                              AS paid,
           (SELECT COALESCE(sum(i.amount - i.amount_paid),0) FROM purchase_installments i
             WHERE i.purchase_id = p.id AND i.status <> 'waived')     AS balance,
           (SELECT count(*) FROM purchase_installments i
             WHERE i.purchase_id = p.id AND i.status = 'paid')        AS paid_count,
           (SELECT count(*) FROM purchase_installments i
             WHERE i.purchase_id = p.id)                              AS total_count,
           (SELECT count(*) FROM purchase_installments i
             WHERE i.purchase_id = p.id AND i.status = 'overdue')     AS overdue_count,
           (SELECT to_jsonb(n) FROM (
              SELECT i.id, i.sequence, i.amount, i.due_date,
                     (i.amount - i.amount_paid) AS remaining
              FROM purchase_installments i
              WHERE i.purchase_id = p.id AND i.status IN ('pending','overdue')
              ORDER BY i.sequence LIMIT 1) n)                         AS next_due,
           (SELECT m.storage_path FROM product_media m
             WHERE m.product_id = p.product_id AND m.kind = 'image'
             ORDER BY m.sort_order LIMIT 1)                           AS image
    FROM purchases p
    WHERE p.member_id = p_member_id
  )
  SELECT jsonb_build_object(
    'totals', jsonb_build_object(
      'purchases',   (SELECT count(*) FROM mine),
      'active',      (SELECT count(*) FROM mine WHERE status IN ('pending','active')),
      'completed',   (SELECT count(*) FROM mine WHERE status = 'fully_paid'),
      'total_value', (SELECT COALESCE(sum(total_payable),0) FROM mine),
      'paid',        (SELECT COALESCE(sum(paid),0) FROM mine),
      'balance',     (SELECT COALESCE(sum(balance),0) FROM mine
                       WHERE status NOT IN ('cancelled','refunded'))
    ),
    'purchases', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', id, 'reference', reference,
        'product', product_name, 'plan', plan_name, 'image', image,
        'total', total_payable, 'paid', paid, 'balance', balance,
        'progress', CASE WHEN total_payable > 0
                         THEN round((paid / total_payable) * 100) ELSE 0 END,
        'installment_amount', installment_amount,
        'paid_count', paid_count, 'total_count', total_count,
        'overdue_count', overdue_count,
        'status', status, 'fulfilment_status', fulfilment_status,
        'next_due', next_due,
        'started_on', started_on, 'completed_at', completed_at
      ) ORDER BY
        -- What still needs paying, first.
        CASE WHEN status IN ('pending','active') THEN 0 ELSE 1 END,
        started_on DESC), '[]'::jsonb)
      FROM mine)
  );
$$;

REVOKE ALL ON FUNCTION get_member_purchases(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_member_purchases(UUID) TO service_role;

-- ============================================================================
-- ONE PURCHASE, IN FULL
-- ============================================================================
-- Takes the member id as well as the purchase id and matches on BOTH. §25 and
-- test 8: changing the id in the URL returns nothing rather than somebody
-- else's television. The filter is in SQL, not in a React guard.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_purchase_detail(p_member_id UUID, p_purchase_id UUID)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'purchase', jsonb_build_object(
      'id', p.id, 'reference', p.reference,
      'product', p.product_name, 'plan', p.plan_name,
      'cash_price', p.cash_price, 'total', p.total_payable,
      'installment_amount', p.installment_amount,
      'deposit_amount', p.deposit_amount,
      'duration_count', p.duration_count, 'frequency', p.frequency,
      'status', p.status, 'fulfilment_status', p.fulfilment_status,
      'started_on', p.started_on, 'completed_at', p.completed_at,
      'paid', (SELECT COALESCE(sum(amount_paid),0) FROM purchase_installments
                WHERE purchase_id = p.id),
      'balance', (SELECT COALESCE(sum(amount - amount_paid),0) FROM purchase_installments
                   WHERE purchase_id = p.id AND status <> 'waived'),
      'media', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                  'kind', m.kind, 'path', m.storage_path) ORDER BY m.sort_order), '[]'::jsonb)
                FROM product_media m WHERE m.product_id = p.product_id)
    ),
    'schedule', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', i.id, 'sequence', i.sequence, 'amount', i.amount,
        'paid_amount', i.amount_paid, 'remaining', i.amount - i.amount_paid,
        'due_date', i.due_date, 'status', i.status, 'paid_at', i.paid_at
      ) ORDER BY i.sequence), '[]'::jsonb)
      FROM purchase_installments i WHERE i.purchase_id = p.id),
    'payments', (
      -- Money that actually reached this purchase, from the allocations —
      -- never from the transaction alone, which may have been spread.
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'reference', a.reference, 'amount', a.amount,
        'at', a.created_at, 'kind', a.kind,
        'installment', (SELECT i.sequence FROM purchase_installments i
                         WHERE i.id = a.installment_id),
        'reversed', a.reversed_at IS NOT NULL
      ) ORDER BY a.created_at DESC), '[]'::jsonb)
      FROM payment_allocations a WHERE a.purchase_id = p.id),
    'fulfilment', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'status', f.status, 'note', f.note, 'at', f.created_at
      ) ORDER BY f.created_at DESC), '[]'::jsonb)
      FROM purchase_fulfilments f WHERE f.purchase_id = p.id)
  )
  FROM purchases p
  WHERE p.id = p_purchase_id AND p.member_id = p_member_id;
$$;

REVOKE ALL ON FUNCTION get_purchase_detail(UUID,UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_purchase_detail(UUID,UUID) TO service_role;

-- ============================================================================
-- THE ADMIN'S VIEW
-- ============================================================================

CREATE OR REPLACE FUNCTION get_admin_purchases(
  p_status TEXT DEFAULT NULL,
  p_search TEXT DEFAULT NULL,
  p_limit  INTEGER DEFAULT 50,
  p_offset INTEGER DEFAULT 0
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH f AS (
    SELECT p.*, m.full_name, m.phone, m.member_id AS member_code,
           (SELECT COALESCE(sum(i.amount_paid),0) FROM purchase_installments i
             WHERE i.purchase_id = p.id) AS paid,
           (SELECT COALESCE(sum(i.amount - i.amount_paid),0) FROM purchase_installments i
             WHERE i.purchase_id = p.id AND i.status <> 'waived') AS balance,
           (SELECT count(*) FROM purchase_installments i
             WHERE i.purchase_id = p.id AND i.status = 'overdue') AS overdue_count
    FROM purchases p JOIN members m ON m.id = p.member_id
    WHERE (p_status IS NULL OR p.status::text = p_status)
      AND (p_search IS NULL OR p_search = '' OR
           m.full_name ILIKE '%'||p_search||'%' OR m.phone ILIKE '%'||p_search||'%' OR
           p.product_name ILIKE '%'||p_search||'%' OR p.reference ILIKE '%'||p_search||'%')
  )
  SELECT jsonb_build_object(
    'totals', jsonb_build_object(
      'matching',  (SELECT count(*) FROM f),
      'collected', (SELECT COALESCE(sum(paid),0) FROM f),
      'outstanding',(SELECT COALESCE(sum(balance),0) FROM f
                      WHERE status NOT IN ('cancelled','refunded')),
      'ready',     (SELECT count(*) FROM f WHERE fulfilment_status = 'ready'),
      'overdue',   (SELECT count(*) FROM f WHERE overdue_count > 0)
    ),
    'purchases', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', id, 'reference', reference,
        'customer', full_name, 'phone', phone, 'member_code', member_code,
        'member_id', member_id,
        'product', product_name, 'plan', plan_name,
        'total', total_payable, 'paid', paid, 'balance', balance,
        'progress', CASE WHEN total_payable > 0
                         THEN round((paid / total_payable) * 100) ELSE 0 END,
        'status', status, 'fulfilment_status', fulfilment_status,
        'overdue_count', overdue_count,
        'started_on', started_on
      ) ORDER BY
        CASE WHEN fulfilment_status = 'ready' THEN 0
             WHEN overdue_count > 0 THEN 1 ELSE 2 END,
        started_on DESC), '[]'::jsonb)
      FROM (SELECT * FROM f
            ORDER BY CASE WHEN fulfilment_status = 'ready' THEN 0
                          WHEN overdue_count > 0 THEN 1 ELSE 2 END, started_on DESC
            LIMIT p_limit OFFSET p_offset) pg)
  );
$$;

REVOKE ALL ON FUNCTION get_admin_purchases(TEXT,TEXT,INTEGER,INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_admin_purchases(TEXT,TEXT,INTEGER,INTEGER) TO service_role;

-- ── Shop figures for the admin dashboard ────────────────────────────────────

CREATE OR REPLACE FUNCTION get_shop_totals()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT jsonb_build_object(
    'products_total',     (SELECT count(*) FROM products),
    'products_published', (SELECT count(*) FROM products WHERE status='published'),
    'customers',          (SELECT count(DISTINCT member_id) FROM purchases),
    'purchases_active',   (SELECT count(*) FROM purchases WHERE status IN ('pending','active')),
    'purchases_complete', (SELECT count(*) FROM purchases WHERE status='fully_paid'),
    'awaiting_fulfilment',(SELECT count(*) FROM purchases WHERE fulfilment_status='ready'),
    'collected',          (SELECT COALESCE(sum(a.amount),0) FROM payment_allocations a
                            WHERE a.purchase_id IS NOT NULL AND a.reversed_at IS NULL),
    'outstanding',        (SELECT COALESCE(sum(i.amount - i.amount_paid),0)
                            FROM purchase_installments i JOIN purchases p ON p.id=i.purchase_id
                            WHERE i.status <> 'waived'
                              AND p.status NOT IN ('cancelled','refunded')),
    'overdue_installments',(SELECT count(*) FROM purchase_installments WHERE status='overdue'),
    'collected_today',    (SELECT COALESCE(sum(a.amount),0) FROM payment_allocations a
                            WHERE a.purchase_id IS NOT NULL AND a.reversed_at IS NULL
                              AND a.created_at::date = CURRENT_DATE)
  );
$$;

REVOKE ALL ON FUNCTION get_shop_totals() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION get_shop_totals() TO service_role;
