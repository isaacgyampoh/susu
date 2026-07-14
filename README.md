# Susu Platform

Full-stack rotating savings platform built for Ghana.

**Stack:** Supabase (Postgres + Edge Functions + Storage) · Next.js 14 (Vercel) · Paystack (optional) · Africa's Talking SMS (optional)

---

## ✅ Quick Setup (UI First — No Paystack/SMS needed)

### Step 1 — Run SQL in Supabase
Go to your Supabase dashboard → SQL Editor → run these two files IN ORDER:

1. `supabase/migrations/01_initial_schema.sql`
2. `supabase/migrations/02_v2_business_rules.sql`

### Step 2 — Create Storage Bucket
Supabase dashboard → Storage → New bucket → name: `kyc-documents` → Public ✓

### Step 3 — Set Edge Function Secrets
Supabase dashboard → Edge Functions → Manage Secrets → add:

| Key | Value |
|-----|-------|
| `JWT_SECRET` | `a45ff29522fcf5f5347f36b4ca5105ad` |
| `FRONTEND_URL` | Your Vercel URL (or `http://localhost:3000`) |

> Paystack and Africa's Talking are optional — the system works without them.
> In dev mode: payments are marked as paid instantly, credentials shown in admin UI.

### Step 4 — Deploy Frontend to Vercel
1. Go to [vercel.com](https://vercel.com) → New Project → Import `isaacgyampoh/susu`
2. Set **Root Directory** to `frontend`
3. Add Environment Variables:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://qaelfwtbaehdwhnxkpid.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFhZWxmd3RiYWVoZHdobnhrcGlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM4OTU2MTMsImV4cCI6MjA5OTQ3MTYxM30.ZYKQHQRG_auKaTameu0VBrFkiNHoczSHDExyz0IgMBk`
4. Deploy

### Step 5 — First Admin Login
URL: `https://your-app.vercel.app/admin/login`
- Email: `admin@susuplatform.com`
- Password: `Admin@1234`

⚠️ Change this password immediately after first login.

---

## How to Test Everything

1. **Create a group** → Admin → Groups → New Group → fill in name, GHS 55/day, 11 members, 30 days, cashout GHS 16,430, reg fee GHS 110
2. **Submit KYC** → Visit `/plans` → Join → fill the form (upload any image for Ghana Card)
3. **Approve member** → Admin → KYC → click Eye → Approve → copy the credentials shown
4. **Member login** → `/login` → enter the phone + passcode from step 3
5. **See dashboard** → member sees their plan, schedule, and can click Pay (marks as paid instantly in dev mode)

---

## Adding Paystack + SMS Later
Just add these secrets in Supabase Edge Functions → Manage Secrets:
- `PAYSTACK_SECRET_KEY` = your key from dashboard.paystack.com
- `AT_API_KEY` + `AT_USERNAME` + `AT_SENDER_ID` = from africastalking.com

The system automatically switches to live mode when the keys are present.
