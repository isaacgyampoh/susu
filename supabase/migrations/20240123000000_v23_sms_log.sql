-- ============================================================
-- V23 — SMS DELIVERY LOG
-- ============================================================
-- Every SMS the system sends is recorded, so the operator can prove a member
-- was notified (or find out why they weren't) instead of relying on memory.

CREATE TABLE IF NOT EXISTS sms_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient   TEXT NOT NULL,
  message     TEXT NOT NULL,
  ok          BOOLEAN NOT NULL DEFAULT false,
  provider    TEXT,
  error       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sms_log_created ON sms_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sms_log_recipient ON sms_log(recipient);

ALTER TABLE sms_log ENABLE ROW LEVEL SECURITY;
