# Phase 09 — Final report

## Deployment

| | |
|---|---|
| Production URL | `https://abbiewealthsusu.com` (public) · `my.` (member) · `admin.` (console) — all HTTP 200 |
| Git commit | `2b465ca` on `main`, pushed — remote and local agree |
| Merge | `phase-09-production-hardening` → `main`, no fast-forward |
| Database | migration v42, 27 functions, 0 drift |
| Edge functions | **52/52 deployed**, 47 updated this phase |
| Frontend | **DEPLOYED** — Vercel serving `2b465ca` |

Production smoke, all live:

```
my.abbiewealthsusu.com/m/login                   200
my.abbiewealthsusu.com/join                      200
my.abbiewealthsusu.com/join/pay/<token>          200   ← new
admin.abbiewealthsusu.com                        200
admin.abbiewealthsusu.com/admin/reconciliation   200   ← new
my.…/admin/*    → 404      admin.…/m/*  → 404          ← hostname isolation holds
```

### The bug that shipping found

`publicSiteUrl()` defaulted to `https://abbiewealthsusu.com`, which reads like
the obvious home for a public page. **It is a separate Vercel project** — a
marketing site that does not serve this application:

```
abbiewealthsusu.com/join/pay/<token>      404
my.abbiewealthsusu.com/join/pay/<token>   200
```

Every registration payment link would have pointed at a page that does not
exist — sent by SMS, to applicants, as the only copy of a token that cannot be
recovered. This is precisely the mistake `_shared/urls.ts` was written to
prevent, made in the file that warns about it, and it survived every local
test because a local test cannot tell you which Vercel project owns a domain.

Caught by requesting the route in production. Fixed and re-verified end to end:
a real token now loads the page and returns the right applicant, fee (GHS 150),
charge (GHS 152.25) and state.

## Tests

```
114 passed (9 files)
  architecture                    10
  money                           18
  allocation                      26
  conformance (hand-written)      16
  conformance (150 generated)      4
  property (3,000 scenarios)       3
  registration settlement         15
  registration conformance        11
  capability tokens               11

tsc     PASS
lint    PASS   (ESLint was never configured; 24 errors and 5 warnings fixed)
build   PASS
```

Live against production:

```
financial invariants        12/13 hold (1 preserved data finding)
§44 multi-group acceptance  19/19
IDOR (database)              8/8
IDOR (live HTTP)            10/10 denied
authentication              11/11
admin totals                16/16 vs independent recomputation
statements                 190/190 memberships reconcile
concurrency                 50 concurrent → one financial effect (6/6)
reversal accounting          8/8
```

## Financial integrity

| | |
|---|---|
| Settlement engine | one — `settle_payment()`; enforced by architecture test |
| Allocation conformance | 16 hand-written + 150 generated scenarios agree to the pesewa |
| Membership isolation | proven at 3 levels: property invariant 6, 150 db scenarios, §44 acceptance |
| Historical data | preserved; nothing repaired by guessing |
| Phase 09 financial movement | **none** |

## Security

| | |
|---|---|
| Privileged anonymous functions | **0** |
| IDOR | none — 8/8 database, 10/10 live cross-access denied |
| Session invalidation | passcode change ends every session (fixed Phase 08, verified live) |
| Secret scan — working tree | **NOT FOUND** |
| Secret scan — built bundles | **NOT FOUND** |
| Secret scan — git history | **FOUND** — service_role key, still live |
| Obsolete endpoints | `moolre-webhook`, `payments-webhook` → 410; 4 repair tools → 410/401 |

### Closed this phase

**A default password no longer buys a working admin token.** Phase 07 made the
console redirect to `/admin/password`; that protected somebody using the
console and nobody using curl. Anyone who read the repository could call
`auth-admin-login` and receive a full-privilege token.

The token is now stamped `pw: 'must_change'` while the flag is set, and
`requireAdmin()` refuses it everywhere except the password-change endpoint.
Verified live:

```
admin dashboard, member list, reconciliation, registrations,
transactions, audit log, payouts        401
change password                         401 "Current password is incorrect"
                                        ← token accepted, password rejected
```

The credential still opens the door, and the only room it reaches is the one
where you change it.

**Three dead admin actions removed.** `/admin/transactions` still offered
"Restore reversed", "Fix overpayments" and "Reconcile with NaloPay" — 82 lines
of prompts and confirmations calling endpoints emptied to 410s. Replaced with a
link to `/admin/reconciliation`, which asks NaloPay and settles only on its
answer.

**`moolreRef` renamed to `providerOrderId`.** The NaloPay adapter's own return
type carried the name of a removed provider, read at six call sites.

**A dead write removed.** `admin-payment-test` inserted a transaction with
`type: 'provider_test'` — a value the `tx_type` enum does not have. The insert
failed every time into a swallowed error handler, while its comment claimed it
existed so a later status check would have something to read.

**Part-paid days now block group deletion.** `groups-create` checked fully-paid
days and payouts; a member who had put GHS 75 towards a GHS 100 day had paid
real money the guard did not see.

**PII removed from the repository.** `docs/phase-03/reconciliation-data.json`
carried 13 real members' names and phone numbers into a repository with a public
remote. Redacted — `kyc_id` and `member_code` still resolve the record for an
authorised administrator, which is where those details belong.

**`supabase/.temp/` gitignored.** It holds `pooler-url`, a Postgres connection
string, and was untracked rather than ignored — one `git add -A` from being
published.

**`adminClient()` refuses to run in a browser.** It carries `service_role`.
Nothing presentational imports it and Next inlines only `NEXT_PUBLIC_*`, so it
could not reach a bundle today — but both of those are properties of the import
graph, and an import graph is one careless `import` away from changing.

## Column names left alone, deliberately

`transactions.paystack_data`, `contributions.paystack_ref` and
`payouts.paystack_transfer_ref` still carry a removed provider's name. Renaming
them means a breaking schema change across 36 code sites and every deployed
function at once, on live financial tables, for a cosmetic gain. The risk
exceeds the benefit. The code-level identifier was renamed; the columns are
documented instead.

## Remaining blockers

**BLOCKER 1: The previously exposed Supabase service_role credential is still
valid and must be rotated by the account owner. Do not paste the new credential
into chat.**

**BLOCKER 2: the repository's `SUPABASE_ACCESS_TOKEN` secret is present but
cannot reach the project.** CI has not deployed a function since 2026-07-24.

The workflow now diagnoses this itself, in step names visible without log
access:

```
PASS   Preflight - is SUPABASE_ACCESS_TOKEN present
FAIL   Preflight - can that token reach the project     ← expired or revoked
skip   Deploy all Edge Functions
```

Rotate it in repository settings → Secrets → Actions. **Production is
unaffected**: functions are deployed directly and are current.

### What that workflow would have done

Its first step ran `supabase secrets set JWT_SECRET=…` on every push to main,
from a GitHub secret never updated when JWT_SECRET was rotated in Phase 05. The
next successful run would have **replaced the rotated signing key with the
published one** — ending every session in production and restoring a key anyone
could read from this repository's history.

It also pushed `MOOLRE_*` credentials for a removed provider, and never pushed
the `NALO_*` credentials for the provider actually in use, so an unset secret
would have written an empty string over a working value.

None of it happened only because the step failed. The workflow no longer manages
secrets at all: a pipeline should ship code, and re-asserting a signing key on
every push means a stale value in one place silently undoes a rotation in
another. It now also fails the deploy if `nalo-webhook` comes back behind JWT
verification, which is the single easiest way to stop settlement.

## Business decisions, still open

```
13 approved registrations, fee unpaid       GHS  1,320.50
 7 marked paid with no payment record       GHS  1,745.00
402 payments pending over 48 hours          GHS 40,658.00
Point-in-time recovery                      disabled — 24-hour recovery floor
```

None auto-resolved. Only provider evidence can settle a pending payment, and
nothing in this system can prove what happened to the other two populations.
