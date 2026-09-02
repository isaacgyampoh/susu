# Security verification

Verified against **live production** on 1 September 2026, after deployment.
Every result below was measured, not inferred.

---

## Resolved

### F-03 — public RPC privilege escalation · CLOSED
```
functions in public schema:            27
reachable by anon / authenticated:      0
all SECURITY DEFINER have search_path: true
default privileges protect future fns: true
```
Verified empirically against the live REST endpoint with the publishable key:
```
POST /rest/v1/rpc/verify_member_passcode  → 401 permission denied
POST /rest/v1/rpc/record_partial_payment  → 401 permission denied
```
Before v25 both executed. The first was unlimited brute-force of a 6-digit PIN
with no rate limit in the path.

### F-15 — forgeable sessions · CLOSED
`JWT_SECRET` in production **was still** the value published in `README.md` and
git history. It had never been rotated, so every admin and member session was
forgeable by anyone who had read the repository.

Rotated to 96 characters of CSPRNG entropy. Verified two ways:
```
functions boot with the new secret        → 401 (not 500)
token forged with the OLD published secret → 401 REJECTED
```

### F-14 — plaintext passcodes · CLOSED
```
members with a passcode:        82
non-bcrypt values:               0
```
All five `hash ?? passcode` fallbacks removed; hashing now fails closed.

### Predictable passcode generation · CLOSED
`Math.random()` replaced with `crypto.getRandomValues` and rejection sampling.
300,000 samples: all 6 digits, full range, uniform within 0.84%.

### Client-side financial authority · CLOSED
The browser sends a *requested amount*. The server resolves the membership, the
obligations and the allocation. It cannot dictate allocation, contribution
status, credit or payout.

### Cross-member access (IDOR) · VERIFIED
Run against live production with two real members (SSU-0007, SSU-0009):

| test | result |
|---|---|
| A previews a payment on B's membership | **404 denied** |
| A starts a payment on B's membership | **404 denied** |
| A starts a payment on B's contribution | **404 denied** |
| A verifies a payment referencing B | **404 denied** |
| *control:* A previews on A's own membership | **200 allowed** |

The control is not decoration — it is what proves the other four are denied by
authorization rather than by everything being broken. It failed twice before
passing, and both failures were real bugs (see below).

### Duplicate webhook settlement · CLOSED
8 simultaneous settlements from separate connections → 1 completion,
7 skipped replays, 5 allocation rows, GHS 450.00 allocated once.

### Payment-reference uniqueness · CLOSED
`uniq_contribution_ref` removed; uniqueness moved to
`payment_allocations(reference, contribution_id)`.

### Global multi-membership credit · CLOSED
`membership_credit_ledger`, foreign-keyed to a membership. Credit in one group
can never settle another's obligation.

### Runtime schema guessing · CLOSED
All nine fallbacks removed after verifying every migration v1–v24 is applied.

---

## OUTSTANDING — requires human action

### The admin console password is publicly known

```
active admin accounts:                    1
still using the published Admin@1234:     1
flagged must_change_password:             1
```

`Admin@1234` appears in `README.md` history, in
`20240101000000_initial_schema.sql`, and in
`20240106000000_v6_force_password_change.sql`. **Anyone who has read this
repository can sign into the admin console.**

The console shows a forced-change banner, but the password itself still works.

**This was deliberately not rotated here.** Unlike `JWT_SECRET`, changing an
admin password requires delivering the new value to a person; doing it without
a secure channel would lock the operator out of their own system. It is a
one-minute fix:

> Sign in → `/admin/password` → set a long random password.

Until then this is the single most serious remaining exposure in the platform.

### Credentials exposed in this working session

Treat as compromised and rotate:

| credential | why |
|---|---|
| Supabase Personal Access Token | pasted into the session; account-wide |
| Supabase `service_role` key | pasted into the session |
| Project JWT secret (Supabase-issued) | returned by the `/postgrest` Management API endpoint in a response |

None reached the repository — verified:
```
Supabase PAT (sbp_)      NOT FOUND
Supabase secret key      NOT FOUND
JWT-format key (eyJ...)  NOT FOUND
private key block        NOT FOUND
```
The `a45ff29...` and `susu-jwt-secret-...` strings that DO appear in
`_shared/jwt.ts` are **denylist entries** — the code names them in order to
refuse them — and are dead values post-rotation.

### Anon key never rotated
Still the original JWT-format key from git history. Acceptable (anon keys are
public by design) but worth rotating for hygiene.

---

## Two bugs the live tests caught that the test suite did not

**1. Gateway JWT verification.** `payments-preview`, being a newly created
function, defaulted to `verify_jwt=true` at the Supabase gateway — which
expects a *Supabase-issued* token, not our custom app JWT. Every request was
rejected before reaching the function. Redeployed with `--no-verify-jwt`; the
function's own `requireMember` check is unchanged and still enforced.

**2. `safeupdate` incompatibility — this one would have broken settlement.**
`settle_payment()` contained `DELETE FROM _queue;` on its temp table. Supabase
enables a guard on the PostgREST path that rejects unqualified DELETE:

```
ERROR: DELETE requires a WHERE clause
```

Every conformance test passed because they ran through the Management API,
which executes SQL directly as `postgres`. The Edge Functions reach the engine
through PostgREST. **The first real payment after deployment would have
failed.** Fixed in v33 (`WHERE true`) and verified through the production path.

The lesson is recorded because it generalises: a test that exercises different
plumbing from production has not tested production.
