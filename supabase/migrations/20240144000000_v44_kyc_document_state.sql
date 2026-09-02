-- ============================================================================
-- v44 — A KYC APPLICATION KNOWS WHETHER ITS DOCUMENT EXISTS
-- ============================================================================
-- 27 of 28 applications hold a Ghana Card NUMBER and no card IMAGE. They were
-- taken while the KYC bucket did not exist and upload errors were discarded, so
-- the application saved cleanly and the file went nowhere.
--
-- The storage side of that is fixed. What is not fixed is that nothing in the
-- system SAYS so. An administrator opening one of those applications got a 500;
-- a reviewer looking at the queue saw an application that appeared complete,
-- because a Ghana Card number is present and the number is what the review
-- screen shows.
--
-- ── WHY THIS IS NOT A DATA REPAIR ───────────────────────────────────────────
--
-- Nothing here reconstructs, infers or fabricates a document. There is no
-- document to recover. This adds a STATE so the absence is visible and
-- actionable, and leaves the applications exactly as they are.
--
-- In particular it does not touch verification: an application whose document
-- was lost must not drift into "verified" because the image is missing rather
-- than rejected. Missing evidence is not evidence.
-- ============================================================================

-- ── 1. Record what happened when an admin asked for a document ──────────────
-- The access log recorded every REQUEST but not its OUTCOME, so "this admin
-- viewed a Ghana Card" and "this admin found the Ghana Card was gone" were
-- indistinguishable in the audit trail. They are very different facts.
ALTER TABLE document_access_log
  ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'signed';

ALTER TABLE document_access_log
  DROP CONSTRAINT IF EXISTS document_access_outcome_valid;
ALTER TABLE document_access_log
  ADD CONSTRAINT document_access_outcome_valid
  CHECK (outcome IN ('signed', 'missing', 'refused'));


-- ── 2. One expression for "is the document actually there" ──────────────────
-- Used by the review queue, the member portal and the re-upload endpoint, so
-- all three agree. A URL that is not a storage path is a legacy public URL and
-- counts as absent: those buckets are gone.
CREATE OR REPLACE FUNCTION kyc_document_state(p_front text, p_back text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN COALESCE(p_front, '') LIKE 'ghana-cards/%' THEN 'present'
    WHEN COALESCE(p_front, '') = ''                 THEN 'missing'
    ELSE 'unusable'
  END;
$$;

REVOKE ALL ON FUNCTION kyc_document_state(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kyc_document_state(text, text) TO service_role, authenticated, anon;


-- ── 3. Who still needs to send one ──────────────────────────────────────────
-- Rejected applications are excluded: a rejected application is finished, and
-- asking somebody to re-upload a document for a decision already made would be
-- a pointless request. Of the 27, that leaves 20 who can still act.
CREATE OR REPLACE VIEW kyc_document_gap AS
SELECT
  k.id,
  k.full_name,
  k.phone,
  k.status,
  k.created_member_id,
  k.submitted_at,
  kyc_document_state(k.ghana_card_front_url, k.ghana_card_back_url) AS document_state,
  (k.created_member_id IS NOT NULL) AS can_use_member_portal
FROM kyc_applications k
WHERE k.status <> 'rejected'
  AND kyc_document_state(k.ghana_card_front_url, k.ghana_card_back_url) <> 'present';

REVOKE ALL ON kyc_document_gap FROM PUBLIC, anon, authenticated;
GRANT SELECT ON kyc_document_gap TO service_role;
