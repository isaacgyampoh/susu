# SusuPlatform — Management Portal

Admin + Member portal for a Ghanaian rotating savings (Susu) platform.

> **Note:** This repo is the **portal only**. The public marketing homepage will be a separate site that links here as a subdomain (e.g. `portal.yourdomain.com`).

**Stack:** Supabase (Postgres + Edge Functions + Storage) · Next.js 14 · Vercel · Paystack *(optional)* · Africa's Talking SMS *(optional)*

---

## Routes

| Route | Who | Purpose |
|-------|-----|---------|
| `/` | Public | Portal entry — pick Member or Admin |
| `/login` | Member | Login with phone + 6-digit passcode |
| `/member/dashboard` | Member | All active plans, balances, next payment, 6PM countdown |
| `/member/payments` | Member | Full payment history + pay now |
| `/member/profile` | Member | Profile, payout schedule, contact admin |
| `/admin/login` | Admin | Login with email + password |
| `/admin` | Admin | Dashboard: stats, upcoming payouts, groups |
| `/admin/members` | Admin | Member list, search, filter |
| `/admin/members/new` | Admin | **Add a member** (generates passcode) |
| `/admin/members/[id]` | Admin | Member detail, suspend/reactivate |
| `/admin/groups` | Admin | Group list + activate (generates schedules) |
| `/admin/groups/new` | Admin | Create group (set cashout, deadline, penalty) |
| `/admin/contributions` | Admin | Track all contributions |
| `/admin/payouts` | Admin | Upcoming payouts, mark as paid |
| `/admin/messages` | Admin | Read + reply to member messages |
| `/admin/announcements` | Admin | Broadcast to members |
| `/admin/kyc` | Admin | Review KYC apps *(for when public site is live)* |

---

## Setup

### 1. Supabase — run SQL
SQL Editor → run in order:
1. `supabase/migrations/20240101000000_initial_schema.sql`
2. `supabase/migrations/20240102000000_v2_business_rules.sql`

### 2. Supabase — storage bucket
Storage → New bucket → name: `kyc-documents` → **Private** (leave Public unticked)

Ghana Cards are national ID documents. The bucket must stay private — admins
view them through short-lived signed URLs minted by `admin-document`, and every
view is recorded in `document_access_log`.

### 3. Supabase — Edge Function secrets
Edge Functions → Manage Secrets:

| Key | Value |
|-----|-------|
| `JWT_SECRET` | `a45ff29522fcf5f5347f36b4ca5105ad` |
| `FRONTEND_URL` | `https://admin.abbiewealthsusu.com` |
| `MEMBER_URL` | `https://my.abbiewealthsusu.com` |
| `ALLOWED_ORIGINS` | comma-separated origins allowed to call the API |
| `PAYMENT_PROVIDER` | `moolre` |
| `MOOLRE_API_USER` | your Moolre username |
| `MOOLRE_API_KEY` | Private API key |
| `MOOLRE_PUB_KEY` | Public API key |
| `MOOLRE_ACCOUNT_NUMBER` | your Moolre wallet number |
| `MOOLRE_SANDBOX` | `true` while testing |
| `PAYSTACK_SECRET_KEY` | only if using Paystack instead |

### Moolre

Members are **not redirected**. Moolre pushes a USSD prompt to their phone and
they approve with their MoMo PIN. Some networks insert an SMS code first — that
is a step, not an error.

**Moolre's callback carries no signature.** Unlike Paystack's HMAC-SHA512, there
is no documented way to prove a callback came from Moolre. So the callback is
treated as a rumour: it tells us which reference to look at, and nothing more.
Every settlement is confirmed by calling Moolre's status endpoint ourselves. Set
the callback in your Moolre dashboard to:

    https://<project>.supabase.co/functions/v1/moolre-webhook

**Channel codes differ by direction.** MTN is `13` when collecting and `1` when
paying out. Same network, same provider, two numbers.

> **Payments fail closed.** Without `PAYSTACK_SECRET_KEY`, payment endpoints
> return 503. To test without Paystack you must set `ALLOW_DEV_PAYMENTS=true`
> deliberately — a missing key can no longer become free contributions.

*Paystack and SMS are optional — the system runs in dev mode without them.*

### 4. Supabase — deploy functions
```bash
supabase link --project-ref qaelfwtbaehdwhnxkpid
supabase functions deploy
```

### 5. Vercel — environment variables
| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://qaelfwtbaehdwhnxkpid.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | *(your anon key)* |

---

## First Login

`/admin/login` → `admin@susuplatform.com` / `Admin@1234`

⚠️ Change immediately:
```sql
UPDATE admin_users SET password_hash = crypt('YourNewPassword', gen_salt('bf'))
WHERE email = 'admin@susuplatform.com';
```

---

## Test Flow

1. **Create a group** → `/admin/groups/new`
   Name, GHS 55/day, 11 members, 30 cycle days, cashout GHS 16,430, reg fee GHS 110, deadline 18:00
2. **Add members** → `/admin/members/new` → copy the passcode shown
3. **Activate group** → `/admin/groups` → Activate → set start date
   *(generates every contribution + payout automatically)*
4. **Member logs in** → `/login` → phone + passcode
5. **Member pays** → dashboard → Pay button *(instant in dev mode)*
6. **Admin marks payout** → `/admin/payouts` → Mark Paid

---

## Dev Mode vs Live Mode

The system auto-detects based on env secrets:

| | Dev (no keys) | Live (keys set) |
|---|---|---|
| Payments | Marked paid instantly | Paystack checkout |
| SMS | Logged to console | Sent via Africa's Talking |
| Credentials | Shown in admin UI | Sent via SMS |

To go live, just add `PAYSTACK_SECRET_KEY` and `AT_API_KEY` + `AT_USERNAME` + `AT_SENDER_ID`.

---

## Business Rules

- Admin sets the **cashout amount manually** — not locked to a formula
- Payment deadline is **6:00 PM** (configurable per group)
- Late payments are **auto-flagged** with a penalty (run via `/admin` → Run Late Check)
- Registration fee is **added to the member's cashout** on payout day
- Members can join **multiple groups** — each shows separately in their portal
- Payout position is assigned in join order; schedule generated on group activation
