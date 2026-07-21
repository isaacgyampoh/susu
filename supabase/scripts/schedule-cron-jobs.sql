-- ============================================================
-- SCHEDULE ALL NIGHTLY / DAILY JOBS  (pg_cron + pg_net)
-- Run ONCE in the Supabase SQL Editor. Re-runnable (cleans up first).
-- ============================================================
--
-- Replace <CRON_SECRET> with the value you set as the CRON_SECRET edge secret.
-- Project ref qaelfwtbaehdwhnxkpid is pre-filled. Times are UTC = Ghana time.
--
--   07:00  daily payment reminders  (texts each member their dial code per group)
--   09:00  payout reminders         (member on standby + admin prepare funds)
--   20:00  daily digest             (day's totals to admins)
--   21:00  flag late / overdue      (applies penalties, texts late members)

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Clean slate
SELECT cron.unschedule('susu-daily-reminders')  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'susu-daily-reminders');
SELECT cron.unschedule('susu-payout-reminders') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'susu-payout-reminders');
SELECT cron.unschedule('susu-daily-digest')     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'susu-daily-digest');
SELECT cron.unschedule('susu-flag-late')        WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'susu-flag-late');

-- 07:00 — daily payment reminders with dial codes
SELECT cron.schedule('susu-daily-reminders', '0 7 * * *', $$
  SELECT net.http_post(
    url     := 'https://qaelfwtbaehdwhnxkpid.supabase.co/functions/v1/cron-daily-reminders?key=<CRON_SECRET>',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
$$);

-- 09:00 — payout reminders (for payouts due tomorrow)
SELECT cron.schedule('susu-payout-reminders', '0 9 * * *', $$
  SELECT net.http_post(
    url     := 'https://qaelfwtbaehdwhnxkpid.supabase.co/functions/v1/cron-payout-reminders?key=<CRON_SECRET>',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
$$);

-- 20:00 — daily digest to admins
SELECT cron.schedule('susu-daily-digest', '0 20 * * *', $$
  SELECT net.http_post(
    url     := 'https://qaelfwtbaehdwhnxkpid.supabase.co/functions/v1/cron-daily-digest?key=<CRON_SECRET>',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
$$);

-- 21:00 — flag late payments, mark overdue, apply penalties
SELECT cron.schedule('susu-flag-late', '0 21 * * *', $$
  SELECT net.http_post(
    url     := 'https://qaelfwtbaehdwhnxkpid.supabase.co/functions/v1/flag-late-payments',
    headers := '{"Content-Type": "application/json", "x-cron-secret": "<CRON_SECRET>"}'::jsonb,
    body    := '{}'::jsonb
  );
$$);

-- Confirm
SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'susu-%' ORDER BY jobname;
