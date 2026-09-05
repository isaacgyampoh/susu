-- ============================================================================
-- v52 — TELL A WRITTEN-OFF PAYMENT FROM ONE THE PROVIDER REFUSED
-- ============================================================================
-- Read-only. Writes no row. Changes no status.
--
-- ── THE PROBLEM ─────────────────────────────────────────────────────────────
--
-- Two different facts share one status. `payment.provider_failed` sets
-- status='failed' because NaloPay said the payment did not complete.
-- `payment.marked_abandoned` sets the same status because an administrator
-- decided it is never going to arrive. Both end up as `failed`, and the
-- payments workspace counts them together.
--
-- That distinction is not cosmetic. Reconciling against a NaloPay statement, a
-- provider-failed payment should appear in that statement as failed; a written
-- off one may not appear at all. An operator who cannot separate them cannot
-- reconcile, and would be chasing NaloPay about payments NaloPay never saw.
--
-- Nothing has been written off yet — all 78 current failures are
-- provider-confirmed — so this lands before the distinction is needed rather
-- than after somebody has to untangle it.
--
-- ── WHY A DESCRIPTION PREFIX AND NOT A NEW ENUM VALUE ───────────────────────
--
-- `tx_status` is pending | success | failed, and adding `abandoned` would be
-- the cleaner model — but every query that filters status='failed' would
-- silently stop counting these, including the workspace's own tabs and totals.
-- A written off payment would vanish from all three rather than move between
-- them. That is a larger and riskier change than the problem justifies today,
-- and it stays available if the volume ever warrants it.
--
-- The prefix is written by exactly one line of code (ABANDONED_PREFIX in
-- admin-reconciliation) and read by exactly one here.
-- ============================================================================

CREATE OR REPLACE FUNCTION payment_failure_kind(p_status text, p_description text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_status <> 'failed'                                    THEN NULL
    WHEN p_description LIKE 'Written off by admin:%'             THEN 'written_off'
    WHEN p_description LIKE 'Marked abandoned by admin.%'        THEN 'written_off'  -- pre-v52 wording
    WHEN p_description ILIKE '%NaloPay reports%'                 THEN 'provider'
    ELSE 'unknown'
  END;
$$;

COMMENT ON FUNCTION payment_failure_kind(text, text) IS
  'For a failed payment: whether the provider refused it, an administrator '
  'wrote it off, or it predates the distinction. NULL when not failed.';

GRANT EXECUTE ON FUNCTION payment_failure_kind(text, text) TO service_role, authenticated, anon;


-- ── The workspace reports the two separately ────────────────────────────────
DO $mig$
DECLARE v_def text; v_before text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_payments_workspace';
  IF v_def IS NULL THEN RAISE EXCEPTION 'get_payments_workspace() not found'; END IF;
  v_before := v_def;

  -- Carry the description through so the row can be classified.
  v_def := replace(v_def,
    'CASE WHEN t.paystack_data ->> ''provider_order_id'' IS NOT NULL
           THEN ''online'' ELSE ''manual'' END      AS channel,',
    'CASE WHEN t.paystack_data ->> ''provider_order_id'' IS NOT NULL
           THEN ''online'' ELSE ''manual'' END      AS channel,
      payment_failure_kind(t.status::text, t.description) AS failure_kind,');

  v_def := replace(v_def,
    '''order_id'', b.order_id, ''created_at'', b.created_at,',
    '''order_id'', b.order_id, ''created_at'', b.created_at,
      ''failure_kind'', b.failure_kind,');

  -- Split the failed total, so "failed" stops meaning two things at once.
  v_def := replace(v_def,
    '''n_failed'',  count(*) FILTER (WHERE status = ''failed'')',
    '''n_failed'',  count(*) FILTER (WHERE status = ''failed''),
      ''n_written_off'', count(*) FILTER (WHERE failure_kind = ''written_off''),
      ''written_off'',   COALESCE(sum(amount) FILTER (WHERE failure_kind = ''written_off''), 0)');

  IF v_def = v_before OR v_def NOT LIKE '%failure_kind%' THEN
    RAISE EXCEPTION 'get_payments_workspace: expected expressions not found — review before rerunning';
  END IF;
  EXECUTE v_def;
END $mig$;
