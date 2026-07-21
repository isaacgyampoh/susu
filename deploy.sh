#!/usr/bin/env bash
# ============================================================
# Abbie Wealth Susu — full deploy
# Run from the repo root:  bash deploy.sh
# ============================================================
set -e

echo "==> 1/3  Deploying the webhook WITHOUT JWT (so NaloPay can reach it)"
supabase functions deploy nalo-webhook --no-verify-jwt

echo "==> 2/3  Deploying all other functions"
supabase functions deploy payments-initialize
supabase functions deploy payments-verify
supabase functions deploy payments-bulk
supabase functions deploy payments-otp
supabase functions deploy admin-reconcile-payments
supabase functions deploy admin-transactions
supabase functions deploy admin-analytics
supabase functions deploy admin-members
supabase functions deploy admin-payment-test
supabase functions deploy kyc-submit
supabase functions deploy kyc-review
supabase functions deploy member-profile
supabase functions deploy member-join-group
supabase functions deploy admin-add-member
supabase functions deploy admin-onboard-member
supabase functions deploy groups-create
supabase functions deploy groups-public
supabase functions deploy groups-activate
supabase functions deploy admin-send-invites
supabase functions deploy announcements
supabase functions deploy flag-late-payments
supabase functions deploy cron-daily-digest
supabase functions deploy cron-daily-reminders
supabase functions deploy cron-payout-reminders

echo "==> 3/3  Done. Now in the app:"
echo "    - Money Received -> Sync from NaloPay (settles any NaloPay confirms)"
echo "    - Money Received -> Force settle (for ones NaloPay shows successful but its status lags)"
echo "    - Make a fresh GHS 1 test payment; it should auto-settle via the webhook."
echo ""
echo "If a payment still won't settle: check the nalo-webhook logs — a COMPLETED"
echo "callback should appear there the moment a payment is approved."
