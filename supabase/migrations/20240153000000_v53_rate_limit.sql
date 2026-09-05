-- ============================================================================
-- v53 — A RATE LIMIT FOR THE PUBLIC ENDPOINTS
-- ============================================================================
-- Writes no financial row. One table, one function.
--
-- ── WHAT WAS UNPROTECTED ────────────────────────────────────────────────────
--
-- Only the two login endpoints were rate limited. `kyc-submit` — the public
-- application form, verify_jwt = false, no session required — writes an
-- application row, performs nine storage operations and sends two SMS per call,
-- with nothing stopping anyone calling it in a loop. That is a filled
-- registration queue, a filled storage bucket and a real SMS bill, from a
-- single unauthenticated caller.
--
-- `registration-payment` is token-addressed but likewise unlimited, and it
-- raises live NaloPay prompts — so an unlimited caller can make somebody's
-- phone ring with payment requests indefinitely.
--
-- ── WHY NOT REUSE login_attempts ────────────────────────────────────────────
--
-- It exists and has a working lockout, but its policy is fixed at 5 in 15
-- minutes and its rows drive the admin PIN gate. Sharing a table between "who
-- may sign in" and "who may submit a form" means one of them changes the other's
-- behaviour the first time a threshold is tuned.
--
-- ── EVERY ATTEMPT IS RECORDED, INCLUDING BLOCKED ONES ───────────────────────
--
-- A caller who keeps hammering keeps extending their own window, which is the
-- behaviour you want from abuse. Somebody who stops for the window length is
-- clear. Counting only successes would let a loop slide the window open again.
-- ============================================================================

CREATE TABLE IF NOT EXISTS rate_limit_hits (
  id     bigserial PRIMARY KEY,
  bucket text NOT NULL,          -- which endpoint, e.g. 'kyc-submit'
  key    text NOT NULL,          -- the caller: request source, or a token
  at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_lookup
  ON rate_limit_hits (bucket, key, at DESC);

REVOKE ALL ON rate_limit_hits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON rate_limit_hits TO service_role;
GRANT USAGE, SELECT ON SEQUENCE rate_limit_hits_id_seq TO service_role;


/**
 * Record this attempt and say whether it is allowed.
 *
 * One call does both, so a check cannot be made and then not recorded — that
 * gap is how a limiter ends up counting fewer attempts than actually happened.
 */
CREATE OR REPLACE FUNCTION hit_rate_limit(
  p_bucket  text,
  p_key     text,
  p_max     integer DEFAULT 10,
  p_minutes integer DEFAULT 60
)
RETURNS TABLE (allowed boolean, retry_after_seconds integer, hits integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_key    text := COALESCE(NULLIF(btrim(p_key), ''), 'unknown');
  v_window interval := make_interval(mins => GREATEST(1, p_minutes));
  v_count  integer;
  v_oldest timestamptz;
BEGIN
  INSERT INTO rate_limit_hits (bucket, key) VALUES (p_bucket, v_key);

  SELECT count(*), min(at) INTO v_count, v_oldest
  FROM rate_limit_hits
  WHERE bucket = p_bucket AND key = v_key AND at > now() - v_window;

  -- Housekeeping, cheap and amortised across callers rather than a cron job.
  DELETE FROM rate_limit_hits WHERE at < now() - interval '24 hours';

  IF v_count > GREATEST(1, p_max) THEN
    RETURN QUERY SELECT
      false,
      GREATEST(1, EXTRACT(EPOCH FROM (v_oldest + v_window - now()))::integer),
      v_count;
  ELSE
    RETURN QUERY SELECT true, 0, v_count;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION hit_rate_limit(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION hit_rate_limit(text, text, integer, integer) TO service_role;
