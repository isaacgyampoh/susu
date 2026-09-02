-- ============================================================================
-- v43 — ADMINISTRATOR SIGN-IN BY PIN
-- ============================================================================
-- Adds one function. Changes no table, no row, no credential.
--
-- The console is moving from email + password to a PIN. The PIN is already
-- stored: `admin_users.password_hash` is bcrypt and holds it, so nothing about
-- how credentials are kept changes — only how they are presented.
--
-- ── THE PROPERTY THAT MATTERS ───────────────────────────────────────────────
--
-- With no email, the PIN is both the IDENTITY and the CREDENTIAL. That is
-- workable for one administrator and dangerous for several: two admins who pick
-- the same four digits would authenticate as whichever row matched first, and
-- with a 4-digit space that collision is likely, not theoretical.
--
-- So this function refuses to guess. If a PIN matches more than one active
-- administrator it returns NOTHING — the sign-in fails rather than
-- authenticating an ambiguous identity. A shared PIN must be a locked door, not
-- a coin toss.
--
-- ── WHAT STILL PROTECTS A FOUR-DIGIT SECRET ─────────────────────────────────
--
-- A 4-digit PIN is 10,000 possibilities. The only thing making that tolerable
-- is the existing lockout: five failures in fifteen minutes. At that rate
-- exhausting the space takes roughly 500 hours. The lockout is therefore not a
-- nicety here — it is the control. `auth-admin-login` keys it on a fixed
-- identifier, because with no email there is nothing caller-supplied left to
-- key on, and a caller-supplied key would let an attacker sidestep it by
-- varying the value.
-- ============================================================================

CREATE OR REPLACE FUNCTION verify_admin_pin(p_pin text)
RETURNS TABLE (
  id                   uuid,
  email                text,
  full_name            text,
  role                 text,
  token_version        integer,
  must_change_password boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE v_matches integer;
BEGIN
  IF p_pin IS NULL OR btrim(p_pin) = '' THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_matches
  FROM admin_users a
  WHERE a.is_active = true
    AND a.password_hash = crypt(p_pin, a.password_hash);

  -- Exactly one, or nobody. Never "the first one that matched".
  IF v_matches <> 1 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT a.id, a.email, a.full_name, a.role,
         COALESCE(a.token_version, 0), COALESCE(a.must_change_password, false)
  FROM admin_users a
  WHERE a.is_active = true
    AND a.password_hash = crypt(p_pin, a.password_hash);
END;
$$;

REVOKE ALL ON FUNCTION verify_admin_pin(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_admin_pin(text) TO service_role;


-- ============================================================================
-- THE GATE IN FRONT OF THE PIN
-- ============================================================================
-- `check_login_allowed()` locks an identifier out after 5 failures in 15
-- minutes. That policy assumes an identifier the ATTACKER supplies — an email
-- — so locking it costs the attacker and nobody else.
--
-- A PIN has no email. The only fixed key left is "the admin login" itself, and
-- keying the existing policy on that would mean any stranger could lock the
-- only administrator out of the console for fifteen minutes, indefinitely, by
-- typing four wrong digits five times. Rate limiting that hands an anonymous
-- caller a reliable outage is not a control, it is the vulnerability.
--
-- So the gate is two counters, not one:
--
--   PER SOURCE   5 failures / 15 min. Stops the obvious attack — one machine
--                walking the PIN space — and is the same policy an email login
--                already gets. A genuine admin who mistypes five times waits,
--                exactly as before.
--
--   GLOBAL      25 failures / 15 min. This is what actually bounds a
--                distributed attack: 10,000 PINs at 25 per quarter hour is
--                ~100 hours of sustained traffic. It sits high enough that
--                locking the real administrator out requires five separate
--                sources and 25 wrong guesses, rather than one browser tab.
--
-- The global counter is the reason a 4-digit secret is defensible at all. If
-- the PIN is ever lengthened, that number is the one to revisit.
-- ============================================================================

CREATE OR REPLACE FUNCTION check_admin_pin_gate(p_source text)
RETURNS TABLE (allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_src_fails integer; v_src_last timestamptz;
  v_all_fails integer; v_all_last timestamptz;
BEGIN
  SELECT count(*), max(attempted_at) INTO v_src_fails, v_src_last
  FROM login_attempts
  WHERE kind = 'admin_pin' AND identifier = COALESCE(p_source, 'unknown')
    AND NOT succeeded AND attempted_at > now() - INTERVAL '15 minutes';

  IF v_src_fails >= 5 THEN
    RETURN QUERY SELECT false,
      GREATEST(0, EXTRACT(EPOCH FROM (v_src_last + INTERVAL '15 minutes' - now()))::integer);
    RETURN;
  END IF;

  SELECT count(*), max(attempted_at) INTO v_all_fails, v_all_last
  FROM login_attempts
  WHERE kind = 'admin_pin'
    AND NOT succeeded AND attempted_at > now() - INTERVAL '15 minutes';

  IF v_all_fails >= 25 THEN
    RETURN QUERY SELECT false,
      GREATEST(0, EXTRACT(EPOCH FROM (v_all_last + INTERVAL '15 minutes' - now()))::integer);
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 0;
END;
$$;

REVOKE ALL ON FUNCTION check_admin_pin_gate(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION check_admin_pin_gate(text) TO service_role;


-- ============================================================================
-- CHANGING THE PIN
-- ============================================================================
-- `change_admin_password()` enforced `length(p_new) < 10`. Sign-in is now four
-- digits, so that rule rejected every PIN the console can actually authenticate
-- with — meaning the administrator could never change theirs, and whatever PIN
-- the system shipped with would be the PIN forever. A password rule left behind
-- after the credential stopped being a password.
--
-- The replacement enforces the shape sign-in requires, and refuses the PIN this
-- system ships with — which appears in the deployment brief and is therefore
-- known to everyone who has read it. That mirrors the `Admin@1234` rule this
-- replaces: a shipped credential may open the door once, and must not be the
-- one somebody deliberately chooses to keep.
--
-- Every rule a new PIN must satisfy lives HERE and only here. The endpoint and
-- the console both check some of them before the round trip, but only so a
-- refusal can be explained sooner — neither is the thing that enforces it. One
-- authority means a rule cannot be tightened in the console and quietly stay
-- loose in the database, which is the failure mode of validation copied into
-- three layers.
-- ============================================================================

CREATE OR REPLACE FUNCTION change_admin_password(p_admin_id uuid, p_current text, p_new text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE v_ok boolean;
BEGIN
  SELECT (password_hash = crypt(p_current, password_hash)) INTO v_ok
  FROM admin_users WHERE id = p_admin_id AND is_active = true;

  IF NOT COALESCE(v_ok, false) THEN RETURN false; END IF;

  IF p_new !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'The PIN must be exactly 4 digits';
  END IF;
  IF p_new = '1024' THEN
    RAISE EXCEPTION 'Choose a PIN that is not the one this system shipped with';
  END IF;

  -- The first guesses anyone makes. Out of 10,000 PINs these are a rounding
  -- error, but they are where an attacker starts, so they are worth refusing.
  IF p_new IN ('0000','1111','2222','3333','4444','5555','6666','7777','8888','9999')
     OR p_new IN ('0123','1234','2345','3456','4567','5678','6789',
                  '9876','8765','7654','6543','5432','4321','3210') THEN
    RAISE EXCEPTION 'That PIN is too easy to guess. Avoid runs and repeated digits.';
  END IF;

  -- A PIN is now an identity as well as a credential; two active admins sharing
  -- one locks out both. Refuse it here too, so it holds no matter which caller
  -- performs the change.
  IF EXISTS (
    SELECT 1 FROM admin_users a
    WHERE a.is_active = true AND a.id <> p_admin_id
      AND a.password_hash = crypt(p_new, a.password_hash)
  ) THEN
    RAISE EXCEPTION 'Another administrator already uses that PIN';
  END IF;

  UPDATE admin_users
  SET password_hash        = crypt(p_new, gen_salt('bf')),
      must_change_password = false,
      token_version        = COALESCE(token_version, 0) + 1
  WHERE id = p_admin_id;

  RETURN true;
END;
$$;


-- ============================================================================
-- RETIRING THE EMAIL PATH
-- ============================================================================
-- `verify_admin_password(email, password)` has no caller left: the console
-- signs in by PIN, and no edge function references it. A SECURITY DEFINER
-- function that authenticates an administrator is not something to leave lying
-- around unused — it is a second front door that nobody is watching, and it is
-- not covered by the PIN gate's rate limiting.
--
-- Dropped rather than left revoked, so a future caller has to add it back
-- deliberately instead of finding it already there.
-- ============================================================================

DROP FUNCTION IF EXISTS verify_admin_password(text, text);


-- ============================================================================
-- NO PIN ORACLE
-- ============================================================================
-- An earlier revision of this migration added `admin_pin_is_taken(admin, pin)`
-- so the change-PIN endpoint could explain a collision. Uniqueness is now
-- enforced inside `change_admin_password()` instead, which leaves that function
-- with no caller — and a function that answers "is this PIN in use?" is an
-- enumeration oracle: 10,000 calls map the entire PIN space, which is precisely
-- what the login gate exists to make expensive.
--
-- It is service_role-only, so it was never reachable from a browser. It is
-- dropped anyway, for the same reason `verify_admin_password` was: an unused
-- function that answers a question about a credential should not be sitting
-- there waiting for a caller.
-- ============================================================================

DROP FUNCTION IF EXISTS admin_pin_is_taken(uuid, text);
