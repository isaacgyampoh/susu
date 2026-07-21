-- ============================================================
-- SCHEDULE THE TWO NIGHTLY JOBS WITH pg_cron + pg_net
-- Run this ONCE in the Supabase SQL Editor.
-- ============================================================
--
-- Before running, replace the two placeholders below:
--   <CRON_SECRET>  — the same value you set as the CRON_SECRET edge secret
--   (the project ref qaelfwtbaehdwhnxkpid is already filled in for you)
--
-- Times are UTC. Ghana is UTC+0 all year, so UTC time = local time.
--   Daily digest     : 20:00 (8pm)
--   Payout reminders : 09:00 (9am)

-- 1. Enable the extensions (safe to run if already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Remove any previous versions of these jobs so re-running is clean
SELECT cron.unschedule('susu-daily-digest')     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'susu-daily-digest');
SELECT cron.unschedule('susu-payout-reminders') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'susu-payout-reminders');

-- 3. Daily payment digest — 8:00 PM every day
SELECT cron.schedule(
  'susu-daily-digest',
  '0 20 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://qaelfwtbaehdwhnxkpid.supabase.co/functions/v1/cron-daily-digest?key=<CRON_SECRET>',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- 4. Payout reminders — 9:00 AM every day (texts anyone due TOMORROW)
SELECT cron.schedule(
  'susu-payout-reminders',
  '0 9 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://qaelfwtbaehdwhnxkpid.supabase.co/functions/v1/cron-payout-reminders?key=<CRON_SECRET>',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- 5. Check they're scheduled
SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'susu-%';

-- To change a time later, just re-run this whole script with the new cron
-- expression. To stop a job:  SELECT cron.unschedule('susu-daily-digest');
