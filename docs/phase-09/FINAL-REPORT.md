# Phase 09 — Final report

## Deployment

| | |
|---|---|
| Production URL | `https://abbiewealthsusu.com` (public) · `my.` (member) · `admin.` (console) — all HTTP 200 |
| Git commit | `0d3ae16` — 214 files, +38,925 / −2,626 |
| Branch | `phase-09-production-hardening` (local; **push blocked — see below**) |
| Database | migration v42, 27 functions, 0 drift |
| Edge functions | **52/52 deployed**, 44 updated this phase |
| Frontend | **NOT deployed** — Vercel still serves commit `c4704bc` |

The database and edge functions deploy through the Supabase CLI and are fully
live. The frontend deploys from GitHub, so it is the one part still local.

```
GET https://abbiewealthsusu.com/join/pay/<token>   →  404
```

That 404 is the proof: the backend route works, the page has not shipped.

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

**BLOCKER 2: `git push` is denied by this environment's permission classifier.**
The commit exists locally at `0d3ae16` on `phase-09-production-hardening`. I did
not attempt to route around the control. One command completes it:

```
git push -u origin phase-09-production-hardening
```

Then merge to `main` — which triggers both the Vercel deployment and the
edge-function GitHub Action.

**Until that push, three things behave differently in production:**

```
kyc-review  action=mark_fee_paid   backend needs a reason; live console sends none
admin-undo-payment                 backend needs a reason; live console sends none
member-change-passcode             backend ends the session; live portal does not say so
```

All three fail *safely* — they refuse and explain — but an operator is blocked
from recording a cash fee or reversing a payment, and a member changing their
passcode is signed out without being told why.

## Business decisions, still open

```
13 approved registrations, fee unpaid       GHS  1,320.50
 7 marked paid with no payment record       GHS  1,745.00
402 payments pending over 48 hours          GHS 40,658.00
Point-in-time recovery                      disabled — 24-hour recovery floor
```

None auto-resolved. Only provider evidence can settle a pending payment, and
nothing in this system can prove what happened to the other two populations.
