-- ============================================================
-- V6 — The seeded admin password is public knowledge
-- ============================================================
-- Admin@1234 is in the repo, in the README, and in this migration. Anyone who
-- finds admin.abbiewealthsusu.com can read it on GitHub and sign in. The seed
-- was fine for a first login; it is not fine to leave standing.

ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false;

-- Any account still on the shipped password is flagged
UPDATE admin_users
SET must_change_password = true
WHERE password_hash = crypt('Admin@1234', password_hash);

-- Changing a password clears the flag and kills every existing session, so a
-- stolen token from before the change stops working.
CREATE OR REPLACE FUNCTION change_admin_password(
  p_admin_id UUID,
  p_current  TEXT,
  p_new      TEXT
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_ok BOOLEAN;
BEGIN
  SELECT (password_hash = crypt(p_current, password_hash)) INTO v_ok
  FROM admin_users WHERE id = p_admin_id AND is_active = true;

  IF NOT COALESCE(v_ok, false) THEN RETURN false; END IF;

  IF length(p_new) < 10 THEN
    RAISE EXCEPTION 'Password must be at least 10 characters';
  END IF;
  IF p_new = 'Admin@1234' THEN
    RAISE EXCEPTION 'Choose a password that is not the shipped default';
  END IF;

  UPDATE admin_users
  SET password_hash        = crypt(p_new, gen_salt('bf')),
      must_change_password = false,
      token_version        = COALESCE(token_version, 0) + 1
  WHERE id = p_admin_id;

  RETURN true;
END;
$$;

-- Surface the flag at sign-in so the console can force the change.
-- Return type widens again, so drop first.
DROP FUNCTION IF EXISTS verify_admin_password(TEXT, TEXT);
CREATE OR REPLACE FUNCTION verify_admin_password(p_email TEXT, p_password TEXT)
RETURNS TABLE (
  id UUID, email TEXT, full_name TEXT, role TEXT,
  token_version INTEGER, must_change_password BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT a.id, a.email, a.full_name, a.role,
         COALESCE(a.token_version, 0), COALESCE(a.must_change_password, false)
  FROM admin_users a
  WHERE a.email = p_email
    AND a.password_hash = crypt(p_password, a.password_hash)
    AND a.is_active = true;
END;
$$;
