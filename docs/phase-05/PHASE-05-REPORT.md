# Phase 05 report — production cutover

1 September 2026 · project `qaelfwtbaehdwhnxkpid` · PostgreSQL 17.6

The split between a migrated database and un-migrated edge functions is
resolved. **47 functions deployed. Production is running the new architecture.**

---

## Status

```
Architecture migration:   COMPLETE
Production deployment:    COMPLETE      47 functions, verified serving
Member portal migration:  COMPLETE      30 memberships returned in 1 query
NaloPay migration:        COMPLETE      provider boundary intact, F-04 closed
Registration payment:     INCOMPLETE    deliberately deferred — see below
Member statements:        INCOMPLETE    not rebuilt
Multiple memberships:     COMPLETE
Per-membership credit:    COMPLETE      ledger live, GHS 130 held
Atomic settlement:        COMPLETE      verified through the production path
Webhook idempotency:      COMPLETE      8-way concurrent → 1 result
Authorization:            COMPLETE
IDOR protection:          COMPLETE      5/5 against live production
Security audit:           COMPLETE      one item requires human action
Legacy financial paths:   REMOVED       no active path bypasses the engine
Tests:                    69/69
TypeScript:               PASS
Production build:         PASS
Production verification:  PASS
```

---

## Production impact

```
Production database changed:    YES   v33 (settlement fix) — code only, no data
Financial data changed:         NO    all counts, totals and 5 hashes unchanged
Payment behaviour changed:      YES   live path now uses the canonical engine
NaloPay behaviour changed:      YES   webhook now REQUIRES provider confirmation
Member portal changed:          YES   all memberships, one query
Registration behaviour changed: NO
Sessions invalidated:           YES   JWT_SECRET rotated — everyone signs in again
```

---

## Two bugs found by deploying that the test suite could not find

Both were caught by verification steps designed to fail loudly, and both would
have been production incidents.

### 1. `JWT_SECRET` was never rotated — deploying blind would have caused an outage

The pre-deployment check compared the stored secret's digest against the value
published in `README.md`. **They matched.** The secret had never been rotated,
which meant two things at once: every session in production was forgeable by
anyone who had read the repository, and the new fail-closed `jwt.ts` — which
explicitly refuses that value — would have taken every function down on deploy.

Rotated to 96 characters of CSPRNG entropy immediately before deploying, so
there was one disruption rather than two. Verified both directions: functions
boot (401, not 500), and a token forged with the old published secret is now
**rejected**.

### 2. Settlement would have failed on the first real payment

`settle_payment()` contained `DELETE FROM _queue;` on its temp table. Supabase
enables a `safeupdate` guard on the PostgREST path that rejects unqualified
DELETE:

```
ERROR: DELETE requires a WHERE clause
```

All 69 unit tests and 16 conformance tests passed, because they ran through the
Management API as `postgres`. The Edge Functions reach the engine through
PostgREST. **The first real payment after deployment would have failed.**

It surfaced because the IDOR suite included a *control* — "member A on their own
membership must SUCCEED" — which returned 500. Without that control, four
passing denial tests would have looked like success.

Fixed in v33 and verified through the production path: GHS 450 against a
GHS 77/day membership → 5 full days + GHS 65 toward the 6th, GHS 12 remaining.

---

## Deployment

Ordered least-risk first so a runtime fault surfaced before money was involved:
`groups-public` → security/read functions → payment paths → disabled repair
tools → webhook (`--no-verify-jwt`) → `cron-settle-pending` last, because it
settles autonomously every ten minutes.

Verified by **response shape**, not by assuming success:

| check | result |
|---|---|
| `admin-dashboard` carries the `anomalies` key (new code only) | yes |
| `totalCollected` | **535,449** (was 433,110.50 truncated) |
| `member-profile` returns `memberships`, no `plans` | yes — **30 memberships** |
| totals match direct SQL | yes (40,668 / 180,882) |
| repair tools | return the disabled message |
| `payments-preview` exists | 401 vs 404 for a non-existent function |

---

## D-05, quantified

Production `max_rows = 1000`; there are 1,497 successful transactions. The old
dashboard fetched them unbounded and summed in JavaScript, so PostgREST
returned only the first 1,000.

| | |
|---|---|
| true total collected | **GHS 535,449.00** |
| what the operator saw | **GHS 433,110.50** |
| understated by | **GHS 102,338.50 (19%)** |

Not a theoretical risk. A headline figure the business was reading, nearly a
fifth short. Now aggregated in the database and correct at any table size.

---

## Financial integrity

**No financial difference across the entire cutover.** All five content hashes
identical before and after deployment and after every live production test.

Cumulative movement since the audit began is fully accounted for: GHS 223
conserved (the F-02 repair), GHS 195 from a real admin cash collection recorded
mid-work, GHS 130 recovered into the credit ledger. Detail in
`FINAL-CHECKSUM.md`.

---

## OUTSTANDING — requires human action

### The admin password is publicly known · URGENT

The sole active admin account still uses `Admin@1234`, which appears in the
README history and two migrations. **Anyone who has read this repository can
sign into the admin console.**

Deliberately not rotated here: changing it requires delivering the new value to
a person, and doing that without a secure channel would lock the operator out.

> **Fix: sign in → `/admin/password` → set a long random password.** One minute.

### Rotate credentials exposed in this session

Supabase Personal Access Token, `service_role` key, and the Supabase-issued
project JWT secret (returned in a Management API response). None reached the
repository — verified.

---

## Deliberately unresolved

1. **13 unpaid registrations, GHS 1,320.50** — preserved and visible via the
   dashboard anomaly panel. Business decision.
2. **402 pending transactions, GHS 40,658** — untouched. The new engine does not
   reinterpret them. Needs NaloPay's collection report.
3. **Allocation ordering** — `LEGACY_SLOT_FIRST` preserved exactly.

---

## Not done

- **Member statements** — not rebuilt. `member-profile` supplies allocation
  history per membership, which covers most of the need, but there is no
  date-ranged statement use case.
- **Registration payment gating** — activation still does not require verified
  payment. The architecture is in place (`ActivateMembership`); wiring it
  changes live business rules and belongs in its own phase with the 13 unpaid
  registrations resolved alongside it.
- **A real end-to-end payment** has not run through the new engine. Everything
  short of moving actual money is verified — preview through the production
  path, settlement under 8-way concurrency, idempotency under 10× replay — but
  no member has yet made a live payment since cutover. `settlement_log` will
  record the first one.
