# Phase 03 report

Infrastructure, financial integrity and production migration.
Executed 1 September 2026 against project `qaelfwtbaehdwhnxkpid`.

---

## Production impact

```
Production database changed:   YES  (5 migrations — see below)
Financial data changed:        YES  (GHS 223.00 moved pending → paid; conserved)
Payment behaviour changed:     NO   (no caller migrated to the new engine yet)
NaloPay behaviour changed:     NO   (integration untouched)
Authentication changed:        NO
Authorization changed:         YES  (22 functions removed from anon — a fix)
```

The single financial change is the F-02 repair, proven conservative: the same
GHS 223.00 moved from pending to paid, with GHS 130.00 of duplicate payment
recovered into a credit ledger. Nothing was created, destroyed or reassigned.

---

## Production state before

82 members (62 active) · 18 groups (11 active) · 266 memberships (195 active) ·
15,707 contributions · 1,924 transactions · 181 allocations · 153 payouts.

GHS 530,260 collected against GHS 1,093,030 expected.

Full detail: `production-ground-truth.md`, `snapshots/before-phase03.json`.

---

## Migrations applied

| | migration | effect | reversible |
|---|---|---|---|
| v25 | function grant lockdown | privileges only | yes — re-grant |
| v26 | payment reference model | additive: credit ledger, index swap, 9 indexes | yes — drop additions |
| v27 | F-02 reconciliation | 4 contributions credited, GHS 130 to credit ledger | data-documented; audit_log records every change |
| v28 | transactional settlement | new function + `settlement_log` | yes — drop function |
| v29 | portal + admin aggregates | two read-only functions | yes — drop functions |

Every one verified with a before/after financial checksum
(`financial-checksum.sql`, runnable at any time).

---

## Security

| | before | after |
|---|---|---|
| functions executable by `anon` | **22** | **0** |
| functions executable by `authenticated` | 22 | 0 |
| functions executable by `service_role` | 22 | 24 |
| RLS policies | 1 | 1 |
| new functions | — | all `SECURITY DEFINER` with pinned `search_path` |

**Verified empirically, not just from the privilege table.** Two attacks were
run against the live REST endpoint with the public anon key:

```
POST /rest/v1/rpc/verify_member_passcode   → 401 permission denied
POST /rest/v1/rpc/record_partial_payment   → 401 permission denied
```

Before v25 both would have executed. The first is unlimited brute-force of a
6-digit PIN with no rate limit in the path; the second marks any contribution
paid for free.

### Credentials
A `service_role` key and `JWT_SECRET` were committed to git (Phase 00). The
service key has been rotated — the replacement uses Supabase's newer secret-key format. The
**anon key has not been rotated** and is still the legacy JWT format; that is
acceptable because anon keys are public by design, but it is worth doing.

A Personal Access Token was pasted into the working session. **It is
account-wide and must be rotated.** It was never written to the repository —
verified with `grep` over the working tree.

---

## Architecture

```
  app/  ·  supabase/functions/          PRESENTATION   (not yet migrated)
              ↓
      src/application/                  APPLICATION
        ├─ ports/                         repositories · PaymentProvider · Clock
        └─ use-cases/                     12 contracts
              ↓
        src/domain/                     DOMAIN — pure, no I/O
          ├─ shared/money.ts              integer minor units
          ├─ membership/                  Member ──< Membership >── Group
          ├─ contribution/                allocation · policy · coverage
          └─ payment/                     Payment ──< PaymentAllocation

     src/infrastructure/                INFRASTRUCTURE
       ├─ supabase/client                 the only createClient()
       ├─ supabase/mappers                DECIMAL string → Money, once
       ├─ supabase/repositories           PortalRepository · AdminTotalsRepository
       └─ payments/nalopay/               boundary documented, adapter pending
```

Enforced by `src/architecture.test.ts`, which fails the build if the domain
imports a framework, database, provider or outer layer; touches the clock or
environment; or if any new module grows a schema-guessing fallback.

---

## Financial migration

| | before | after | Δ |
|---|---|---|---|
| members | 82 | 82 | — |
| groups | 18 | 18 | — |
| memberships | 266 | 266 | — |
| contributions | 15,707 | 15,707 | — |
| transactions | 1,924 | 1,924 | — |
| allocations | 181 | 181 | — |
| payouts | 153 | 153 | — |
| audit_log | 519 | **523** | +4 |
| contributions paid | 530,260.00 | **530,483.00** | **+223.00** |
| contributions pending | 558,484.00 | **558,261.00** | **−223.00** |
| every other total | — | — | **unchanged** |
| credit ledger | (did not exist) | **GHS 130.00** | duplicate recovered |

Content hashes over `transactions`, `payouts`, `memberships` and `allocations`
are byte-identical before and after. Only `contributions` changed, by exactly
the four repaired rows.

---

## Tests

| suite | tests | what it proves |
|---|---|---|
| architecture | 6 | layer boundaries hold; no schema guessing |
| money | 18 | integer arithmetic; 365-day accumulation exact; PostgreSQL-matching rounding |
| allocation | 26 | every specified worked example; isolation; both policies pinned |
| properties | 3 | invariants over 3,000 generated scenarios × 3 policies |
| **conformance** | **16** | **pure allocator == deployed `settle_payment()`, to the pesewa** |
| **Total** | **69** | all passing |

Plus, run directly against production inside rolled-back transactions:
- **13 conformance scenarios** through the real `settle_payment()`
- **idempotency**: 1 delivery vs 10 → identical financial state
  (5 allocations, GHS 450.00, 4 days paid), 9 replays correctly logged as skipped

`tsc` clean · `next build` passes.

---

## What is verified vs what is not

**Verified.** F-03 closed (empirically). F-02 mechanism, damage and repair.
D-01 deployed body. Credit balances zero. Migration state. Index absence.
Settlement conformance and idempotency. Financial conservation.

**Not verified.** Concurrent settlement under genuine parallelism — the
`FOR UPDATE` lock and the `ON CONFLICT` constraint are both in place and
sequential replay is proven, but two truly simultaneous connections were not
raced through the API. The 402 pending transactions await NaloPay's report.
No caller has been migrated to the new engine, so the new path has not carried
live traffic.

---

## Remaining legacy

Five settlement implementations remain callable; the replacement is deployed
and tested but no caller is migrated. `admin-dashboard` still fetches every
successful transaction into JavaScript. `member-profile` still issues 6 + 2N
queries. `members.credit_balance` still read by two files. The portal still
computes money in React.

Full classification: `legacy-map.md`.

---

## Decisions still required

1. **13 unpaid registrations, GHS 1,320.50** — suspend, invoice or write off.
   Most affected members are already suspended; the live exposure is chiefly
   SSU-0033 (GHS 602.00, active, 5 memberships). See `registration-reconciliation.md`.
2. **402 pending transactions, GHS 40,658** — needs NaloPay's July–September
   collection report. No state changed. See `payment-reconciliation-analysis.md`.
3. **Allocation ordering** — `LEGACY_SLOT_FIRST` preserved as instructed.
   Switching to arrears-first moves real balances and needs approval.

**Resolved from data, no longer needing a decision:** the 65 payout overrides
are legitimate. 62 are `onboarded_existing` with real historical amounts and
**24 have already been paid at that figure**. The stored value is
authoritative; the group cashout is only a default. Both are now modelled
explicitly. The 37 memberships without schedules are all in groups that have
never been activated — correct behaviour, not a defect. Only 5 memberships in
active groups genuinely lack a payout date.
