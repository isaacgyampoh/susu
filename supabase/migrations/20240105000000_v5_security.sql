-- ============================================================
-- V5 — Security hardening
-- ============================================================

-- ── 1. Ghana Cards must not be publicly readable ──
-- These are national ID documents. A public bucket means anyone with the URL
-- can read them, and the paths are semi-predictable from a phone number.
-- Private bucket + short-lived signed URLs generated only for admins.
UPDATE storage.buckets SET public = false WHERE id = 'kyc-documents';

-- Remove any permissive policies left from the original setup
DROP POLICY IF EXISTS "Public read kyc-documents" ON storage.objects;
DROP POLICY IF EXISTS "Allow KYC uploads"        ON storage.objects;

-- Uploads and reads happen only through Edge Functions using the service role,
-- which bypasses RLS. No anon/authenticated policy is created on purpose:
-- nothing outside those functions should touch this bucket.

-- ── 2. Tighten the storage path ──
-- Paths were ghana-cards/{phone}-front-{timestamp}: knowing a member's number
-- narrows the guess to a timestamp. New uploads use an unguessable id.
-- (Enforced in kyc-submit / admin-add-member; nothing to migrate.)

-- ── 3. Audit trail for document access ──
-- Viewing someone's national ID is a privileged act and should be recorded.
CREATE TABLE IF NOT EXISTS document_access_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id    UUID REFERENCES admin_users(id),
  admin_name  TEXT,
  subject     TEXT NOT NULL,        -- whose document
  object_path TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_doc_access ON document_access_log(created_at DESC);
ALTER TABLE document_access_log ENABLE ROW LEVEL SECURITY;

-- ── 4. Sessions should be revocable ──
-- A stolen 7-day JWT is currently valid for 7 days with no way to kill it.
-- Bumping a member's or admin's token_version invalidates their tokens at once.
ALTER TABLE members     ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 0;
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS token_version INTEGER DEFAULT 0;

CREATE OR REPLACE FUNCTION revoke_member_sessions(p_member_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE members SET token_version = COALESCE(token_version, 0) + 1 WHERE id = p_member_id;
END;
$$;

CREATE OR REPLACE FUNCTION revoke_admin_sessions(p_admin_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE admin_users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = p_admin_id;
END;
$$;

-- Suspending or removing a member must also cut their live session
CREATE OR REPLACE FUNCTION fn_revoke_on_suspend()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('suspended','removed') AND OLD.status = 'active' THEN
    NEW.token_version := COALESCE(OLD.token_version, 0) + 1;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_revoke_on_suspend ON members;
CREATE TRIGGER trg_revoke_on_suspend
  BEFORE UPDATE OF status ON members
  FOR EACH ROW EXECUTE FUNCTION fn_revoke_on_suspend();

-- verify_member_passcode must return the version so the token can carry it.
-- The return type widens, and Postgres refuses that under CREATE OR REPLACE
-- (42P13) — the old signature has to go first.
DROP FUNCTION IF EXISTS verify_member_passcode(TEXT, TEXT);
CREATE OR REPLACE FUNCTION verify_member_passcode(p_phone TEXT, p_passcode TEXT)
RETURNS TABLE (
  id UUID, member_id TEXT, full_name TEXT,
  phone TEXT, status member_status, whatsapp_number TEXT, token_version INTEGER
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT m.id, m.member_id, m.full_name, m.phone, m.status, m.whatsapp_number,
         COALESCE(m.token_version, 0)
  FROM members m
  WHERE m.phone = p_phone
    AND m.passcode_hash = crypt(p_passcode, m.passcode_hash)
    AND m.status = 'active';
END;
$$;

DROP FUNCTION IF EXISTS verify_admin_password(TEXT, TEXT);
CREATE OR REPLACE FUNCTION verify_admin_password(p_email TEXT, p_password TEXT)
RETURNS TABLE (id UUID, email TEXT, full_name TEXT, role TEXT, token_version INTEGER)
LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  RETURN QUERY
  SELECT a.id, a.email, a.full_name, a.role, COALESCE(a.token_version, 0)
  FROM admin_users a
  WHERE a.email = p_email
    AND a.password_hash = crypt(p_password, a.password_hash)
    AND a.is_active = true;
END;
$$;

-- Cheap check used by requireMember/requireAdmin on every request
CREATE OR REPLACE FUNCTION session_is_current(p_id UUID, p_kind TEXT, p_version INTEGER)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v INTEGER;
BEGIN
  IF p_kind = 'admin' THEN
    SELECT COALESCE(token_version, 0) INTO v FROM admin_users WHERE id = p_id AND is_active = true;
  ELSE
    SELECT COALESCE(token_version, 0) INTO v FROM members WHERE id = p_id AND status = 'active';
  END IF;
  IF v IS NULL THEN RETURN false; END IF;   -- deleted, suspended or deactivated
  RETURN v = COALESCE(p_version, 0);
END;
$$;
