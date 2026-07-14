# Susu Platform

A full-stack rotating savings (Susu) platform for Ghana, built with:

- **Backend** — Supabase (Postgres + Edge Functions + Storage)
- **Frontend** — Next.js 14 (TypeScript) on Vercel
- **Payments** — Paystack (mobile money + card)
- **SMS/Notifications** — Africa's Talking

---

## Project Structure

```
susu-system/
├── supabase/
│   ├── config.toml                          # Supabase local dev config
│   ├── .env.example                         # Edge function secrets
│   ├── migrations/
│   │   └── 20240101000000_initial_schema.sql
│   └── functions/
│       ├── _shared/                         # Shared helpers
│       │   ├── cors.ts
│       │   ├── supabase-admin.ts
│       │   ├── jwt.ts
│       │   ├── paystack.ts
│       │   └── africas-talking.ts
│       ├── auth-admin-login/               # POST: admin login
│       ├── auth-member-login/              # POST: member login (phone + passcode)
│       ├── kyc-submit/                     # POST: submit KYC + upload Ghana Card
│       ├── kyc-review/                     # POST: admin approve/reject KYC
│       ├── groups-public/                  # GET: public groups list
│       ├── groups-create/                  # GET/POST/PATCH: admin manage groups
│       ├── groups-activate/                # POST: start a group + generate schedule
│       ├── contributions-list/             # GET: member or admin view contributions
│       ├── payments-initialize/            # POST: init Paystack payment
│       ├── payments-verify/                # POST: verify Paystack payment
│       ├── payments-webhook/               # POST: Paystack webhook handler
│       ├── payouts-admin/                  # GET/PATCH: admin view + mark payouts paid
│       ├── member-profile/                 # GET: full member dashboard data
│       ├── admin-dashboard/                # GET: admin dashboard stats
│       ├── admin-members/                  # GET/PATCH: manage members
│       ├── announcements/                  # GET/POST: create + list announcements
│       └── notifications-send/             # POST: manual SMS trigger
└── frontend/
    ├── app/
    │   ├── page.tsx                        # Landing page
    │   ├── plans/page.tsx                  # Browse susu groups
    │   ├── join/[groupId]/page.tsx         # KYC form + payment
    │   ├── login/page.tsx                  # Member login
    │   ├── member/
    │   │   ├── dashboard/page.tsx          # Member portal home
    │   │   ├── payments/page.tsx           # Payment history
    │   │   └── profile/page.tsx            # Member profile + plans
    │   └── admin/
    │       ├── login/page.tsx              # Admin login
    │       ├── page.tsx                    # Dashboard overview
    │       ├── members/page.tsx            # Members list
    │       ├── members/[id]/page.tsx       # Member detail + actions
    │       ├── groups/page.tsx             # Groups + activate
    │       ├── groups/new/page.tsx         # Create group
    │       ├── kyc/page.tsx                # KYC review
    │       ├── contributions/page.tsx      # Contributions tracker
    │       ├── payouts/page.tsx            # Payouts + mark paid
    │       └── announcements/page.tsx      # Broadcast messages
    └── middleware.ts                       # Route protection
```

---

## Deployment Guide

### 1. Supabase Setup

**Create a new project at [supabase.com](https://supabase.com)**

**Run the database migration:**
```bash
# Option A: Supabase CLI (recommended)
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
supabase db push

# Option B: Paste directly in Supabase SQL Editor
# Go to: Dashboard → SQL Editor → New query
# Paste contents of: supabase/migrations/20240101000000_initial_schema.sql
# Click Run
```

**Create the KYC documents storage bucket:**
```sql
-- Run in Supabase SQL Editor
INSERT INTO storage.buckets (id, name, public)
VALUES ('kyc-documents', 'kyc-documents', true);

-- Allow all reads (admins will view via signed URLs in production)
CREATE POLICY "Public read kyc-documents" ON storage.objects
  FOR SELECT USING (bucket_id = 'kyc-documents');

-- Allow authenticated uploads
CREATE POLICY "Allow KYC uploads" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'kyc-documents');
```

**Set Edge Function secrets** (Dashboard → Edge Functions → Manage secrets):
```
JWT_SECRET          = <strong random string, 32+ chars>
PAYSTACK_SECRET_KEY = sk_live_xxxx   (or sk_test_xxxx for testing)
AT_API_KEY          = <Africa's Talking API key>
AT_USERNAME         = <Africa's Talking username>
AT_SENDER_ID        = SUSU
FRONTEND_URL        = https://your-app.vercel.app
```

**Deploy all Edge Functions:**
```bash
supabase functions deploy auth-admin-login
supabase functions deploy auth-member-login
supabase functions deploy kyc-submit
supabase functions deploy kyc-review
supabase functions deploy groups-public
supabase functions deploy groups-create
supabase functions deploy groups-activate
supabase functions deploy contributions-list
supabase functions deploy payments-initialize
supabase functions deploy payments-verify
supabase functions deploy payments-webhook
supabase functions deploy payouts-admin
supabase functions deploy member-profile
supabase functions deploy admin-dashboard
supabase functions deploy admin-members
supabase functions deploy announcements
```

---

### 2. Paystack Setup

1. Go to [dashboard.paystack.com](https://dashboard.paystack.com)
2. Add your webhook URL: `https://YOUR_PROJECT_REF.supabase.co/functions/v1/payments-webhook`
3. Webhook events to enable: `charge.success`
4. Copy your Secret Key → add as `PAYSTACK_SECRET_KEY` in Supabase secrets

---

### 3. Africa's Talking Setup

1. Register at [africastalking.com](https://africastalking.com)
2. Create an SMS sender ID (`SUSU` or your brand name)
3. Copy API Key + Username → add to Supabase secrets
4. Fund your SMS credits

---

### 4. Frontend (Vercel) Setup

```bash
cd frontend
npm install
```

**Create `.env.local`:**
```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
```

**Test locally:**
```bash
npm run dev
# Visit http://localhost:3000
```

**Deploy to Vercel:**
```bash
npm install -g vercel
vercel --prod
```
Or connect your GitHub repo in the Vercel dashboard and it auto-deploys.

**Set Vercel environment variables** (Project → Settings → Environment Variables):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

---

## First Login

**Admin:** `admin@susuplatform.com` / `Admin@1234`
⚠️ **Change this password immediately** in the Supabase SQL editor:
```sql
UPDATE admin_users
SET password_hash = crypt('YourNewPassword', gen_salt('bf'))
WHERE email = 'admin@susuplatform.com';
```

---

## Business Flow

```
1. Admin creates a susu group (name, amount, cycle_days, max_members)
2. Public browses groups at /plans
3. Member fills KYC form → uploads Ghana Card → pays registration fee (Paystack)
4. Webhook confirms fee → KYC marked as fee-paid
5. Admin reviews KYC → clicks Approve
6. System creates member account with SSU-XXXX ID + 6-digit passcode
7. Africa's Talking sends SMS with credentials
8. Member logs in at /login with phone + passcode
9. Once group is full → admin sets start date → clicks Activate
10. System generates full contribution schedule (daily rows) + payout records
11. Members receive SMS with their payout date and expected amount
12. Daily: member gets SMS reminder → logs into portal → clicks Pay → Paystack
13. Webhook marks contribution as paid → confirmation SMS sent
14. On payout date: admin views upcoming payouts → sends money → clicks Mark Paid
15. Member notified via SMS 🎉
```

---

## Payout Formula

```
Payout per member = contribution_amount × max_members × cycle_days

Example: GHS 50/day × 15 members × 15 days = GHS 11,250 per member
Total group duration: 15 members × 15 days = 225 days
```

---

## Stack Versions

| Package | Version |
|---------|---------|
| Next.js | 14.1.0 |
| @supabase/supabase-js | ^2.39 |
| Tailwind CSS | ^3.4 |
| TypeScript | ^5.3 |
| date-fns | ^3.3 |
| lucide-react | ^0.316 |
