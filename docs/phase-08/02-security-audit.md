# 02 — Security audit

Everything below was executed against production on 1 September 2026. Results
are evidence, not assessment.

## Verdict

| Control | State |
|---|---|
| Privileged anonymous RPC | **none** — 0 non-trigger functions executable by `anon`/`authenticated` |
| Arbitrary SQL endpoint | **none** — no `exec_sql` exists, and none was created |
| SECURITY DEFINER `search_path` | 27/27 pinned |
| Credentials in the working tree | **NOT FOUND** |
| Credentials in git history | **FOUND** — 2 Supabase keys; one **still live**, see below |
| Fail-closed authentication | verified — a locked account refuses even the CORRECT passcode |
| Login lockout | 5 failures / 15 minutes, admin and member alike |
| Passcode storage | bcrypt; generation uses `crypto.getRandomValues` with rejection sampling |
| Capability tokens | 256-bit, SHA-256 at rest, 14-day expiry, one application each |
| Session revocation on credential change | **fixed this phase** — see §2 |
| IDOR | 10/10 live cross-access attempts denied; 8/8 database checks pass |
| Destructive admin paths | **gated this phase** — see §3 |

## 1. ROTATION REQUIRED — the published service_role key is still live

Two Supabase keys were committed on 12 July 2026 and remain in git history. The
repository has a GitHub remote.

```
role=service_role   issued 2026-07-12   expires 2036-07-12   STILL LIVE
role=anon           issued 2026-07-12   expires 2036-07-12   (anon is public by design)
```

The service_role key was tested against production this phase: **it returned
member rows.** `service_role` bypasses row-level security entirely — unrestricted
read and write on members, Ghana Card numbers, passcode hashes, contributions,
payments, payouts and the audit log.

This cannot be closed from here. **Dashboard action required:** Supabase →
Project Settings → API → *Reset service_role key*. Edge functions pick the new
one up automatically. Steps in `ROTATION.md`.

Rotation stops future use; it says nothing about past use. The API logs for the
exposure window are worth reading for service-role requests from IPs that are
neither Vercel nor Supabase.

```
PAT                     NOT VERIFIED   — rotation required
service_role            NOT ROTATED    — proven live, rotation required
project JWT secret      NOT VERIFIED   — rotation required
application JWT_SECRET  ROTATED        (Phase 05, 96 characters)
default admin password  STILL ACTIVE   — console gated on it since Phase 07
```

## 2. Closed this phase — a passcode change left every session alive

Changing a member's passcode replaced the hash and **nothing else**. Every token
issued before the change kept working for its full two-day life.

That defeats the main reason a member changes their passcode. Someone who read
it over their shoulder, or who was handed the phone, already has a signed-in
session; changing the passcode stopped them signing in *again* while leaving the
session they already had untouched.

The mechanism was already present and already used elsewhere — `token_version`,
which `session_is_current()` checks on every request, which the suspension
trigger bumps, and which `change_admin_password()` bumps. **Members were the
only ones it did not reach.**

The bump now happens in the same UPDATE as the hash, conditional on the version
not having moved, so a session can never outlive a hash it no longer matches.

Verified live, after deployment:

```
signed in                       HTTP 200
change passcode                 HTTP 200   session_ended=true
OLD token after the change      HTTP 401   ← was 200 before the fix
sign in with the NEW passcode   HTTP 200   (not locked out)
```

## 3. Closed this phase — an admin could destroy the entire financial history

Two paths in `admin-members`, both reachable over HTTP by the single
`super_admin`:

```
DELETE ?all=true  { confirm: 'DELETE ALL MEMBERS' }
     → DELETE FROM transactions, contributions, payouts, group_memberships, members

DELETE ?id=<member>
     → DELETE that member's transactions, contributions, payouts
```

The single delete refused only when the member had a **paid payout** — money
received. It did not check money *paid*: a member two years into a daily susu
with GHS 40,000 contributed and no payout yet was deletable, and their entire
payment record went with them. The mass wipe had no guard at all beyond a
confirmation phrase, and a phrase is not a preservation strategy — particularly
with point-in-time recovery disabled, where the recovery floor is the last
nightly backup.

Both now refuse while settled money exists, and both refusals are audited.
Verified live through a real admin session:

```
DELETE a member with payment history   409  "1 settled payment(s), 1 paid day(s) on record"
DELETE ALL MEMBERS                     409  "1517 settled payment(s) and 5693 paid contribution day(s)"
members 84  contributions 15717  transactions 1945   ← nothing destroyed
audit: member.delete_refused, members.wipe_refused
```

Deletion remains available for what it was written for — duplicates and mistyped
entries, which carry none of that history.

## 4. Authorization / IDOR — tested live, with real sessions

Two complete members were created, **signed in through the real login endpoint**,
and member A attempted every cross-object access §6 lists.

```
A reads B's statement (membership_id=B)      404  Membership not found
A starts a payment on B's membership         404  Membership not found
A starts a payment on B's contribution       404  Contribution not found
A previews a payment on B's membership       404  Membership not found
A verifies B's payment                       404  Payment not found
A bulk-pays B's contributions                404  Contributions not found
A lists contributions filtered to B          200  ← A's own 5 rows; 0 of B's
A uses B's capability token                  404  This payment link is not valid
A calls an admin endpoint                    401  Invalid JWT
A calls the admin member list                401  Unauthorized
```

The one 200 was checked row by row: A received five contributions, all GHS 100
(A's group is 100/day, B's is 150/day), **all belonging to A and none to B.**
The `member_id` parameter is read only in the admin-authenticated branch.

Capability tokens, with well-formed 43-character values:

```
token A → P08 Applicant A          token B → P08 Applicant B
initiate with A's token + B's kyc_id, registration_id and amount in the body
   → prompt raised against A's application; transactions against B: 0
```

Only four fields are ever read from that endpoint's request body: `token`,
`action`, `pay_number`, `pay_network`. There is no id parameter and no amount
parameter to tamper with.

## 5. Authentication

```
wrong passcode                          401  Invalid phone or passcode
unknown phone                           401  Invalid phone or passcode   ← identical: no enumeration
no passcode                             400
change passcode, wrong current one      401
new passcode = 111111                   400  too easy to guess
new passcode = 123456                   400  too easy to guess
new passcode 5 digits                   400
tampered token signature                401
no token                                401
5 failed logins, then a 6th             429  locked for 15 minutes
CORRECT passcode while locked out       429  ← fails closed
```

## 6. Failure modes

```
webhook: garbage payload                200, nothing recorded
webhook: unknown order id               200, nothing recorded
webhook: claims success, no order id    200, nothing recorded
neutralised provider webhooks           410, nothing recorded
registration: unknown / malformed / absent token   404, all identical
registration: expired link              410
registration: already paid → initiate   409
```

After every one of these: **0 transactions, 0 allocations, 0 settlements
created.**

## 7. Database function surface

```
non-trigger functions                32
SECURITY DEFINER                     27  (27/27 with a pinned search_path)
reachable by anon or authenticated    0
mutating financial state             11  (all service_role only)
trigger functions                     5  (PostgreSQL refuses to call them directly; PostgREST does not expose them)
```

`search_path` values in use:

```
public, extensions, pg_temp   — functions needing pgcrypto or uuid-ossp
public, pg_temp               — everything else
```

`extensions` is not decoration: `pgcrypto` lives there, so the reflexive
`public, pg_temp` would break every passcode check on the platform.
