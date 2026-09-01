# Final report

Membership platform rebuild · 1 September 2026
Project `qaelfwtbaehdwhnxkpid` · PostgreSQL 17.6 · 49 edge functions deployed

---

## Status

```
Clean Architecture              COMPLETE
Production deployment           COMPLETE       49 functions, verified serving
Multiple memberships            COMPLETE       30 returned in one query
Payment allocation              COMPLETE       one engine, conformance-bound
Advance payments                COMPLETE       verified end to end
Per-membership credit           COMPLETE       ledger, FK-scoped
Payment history                 COMPLETE       with allocation breakdown
Member statements               COMPLETE       485/485 reconcile
Registration payment            COMPLETE       gated, audited override
NaloPay verification            COMPLETE       provider is authoritative
Webhook idempotency             COMPLETE       8-way concurrent → 1 result
Atomic settlement               COMPLETE       verified through PostgREST
Authorization                   COMPLETE
IDOR protection                 COMPLETE       5/5 against live production
Admin reporting                 COMPLETE       database aggregation
Security                        COMPLETE*      *one item needs a human — below
Legacy settlement paths         REMOVED
Runtime schema guessing         REMOVED
Tests                           69/69
TypeScript                      PASS
Build                           PASS
Production verification         PASS
```

---

## Production impact this phase

```
Production database changed:  YES   v34–v36 — read-only functions + search_path pinning
Financial data changed:       NO    all counts, totals and 5 hashes unchanged
Payment behaviour changed:    YES   registration fees no longer break settlement
Member portal changed:        YES   statements added
Registration behaviour:       YES   approval now requires a paid fee or an audited override
```

---

## What was built

### Member statements
`get_member_statement()` — per membership, date-ranged, aggregated in the
database. The accounting identity is stated on the page rather than summarised:

```
opening + fell due − settled − covered in advance = closing
```

**485 of 485 statements reconcile exactly** across 25 members × 5 periods.

Getting there took three attempts, and each failure was informative. The first
used *current* status for the closing balance, so a day settled after the
period end silently vanished. The second omitted the term for days that fell
due within the period but had **already been paid in advance** — the
advance-payment feature showing up in the accounting. 13 of 291 statements
failed until that term was added.

Where the data cannot support a complete answer, the statement says so.
Payment attribution only exists from 24 July 2026; before that, four of the
five legacy paths recorded no allocation. The statement reports
`attribution_complete: false` and explains why, rather than inferring which
payment covered which day across GHS 400,000 of history.

### Registration payment gating
`kyc-review` now refuses to approve an application whose fee is unpaid:

```
402  registration_fee_unpaid
     "The registration fee of GHS 150.00 has not been received.
      Approving now would activate a membership that has not been paid for."
```

Verified live: **nothing was created**, the application stayed pending. An
override exists, requires a reason of at least ten characters, and writes to
the audit log — it never fabricates a payment record.

### A regression I introduced, and caught
Every `registration_fee` transaction has `related_id = NULL`. My Phase 04/05
rewrite routed *all* payments through `settle_payment()`, which anchors to an
obligation — so a registration fee would have raised:

> Payment X has GHS N unallocated and no originating membership

**All 36 registration fees, 34 of them currently pending, would have failed to
settle.** Fixed with `_shared/registration-fee.ts` and a type branch in all
three settlement callers. A registration fee buys a place in a group; it
discharges no daily obligation and is never allocated to one.

### Reconciliation queue
`get_reconciliation_queue()` + `admin-reconciliation` surface the two
unresolved populations with everything needed to decide, and record every
resolution in the audit log.

The stuck-payment actions deliberately offer **no "mark successful"**. The
provider decides whether a payment succeeded; recording that from a console
would be manufacturing a financial fact. The only action is "abandoned", which
asserts nothing about the provider.

### Financial invariants
`docs/phase-06/financial-invariants.sql` — 10 checks, runnable against
production, safe to schedule. **All 10 hold, zero violations.**

### search_path hardening
22 legacy SECURITY DEFINER functions had no pinned `search_path`. All pinned.

The obvious path — `public, pg_temp` — would have broken every passcode check
and member insert in the platform, because `pgcrypto` and `uuid-ossp` live in
the `extensions` schema. Verified before writing, and password verification
re-tested immediately after.

---

## §50 acceptance scenario — passed exactly

Five memberships (₵100/150/50/200/75 daily), run against the production engine
in a rolled-back transaction:

```
memberships visible                    5

pay GHS 450 into Group A
  2026-09-01   GHS 100   full
  2026-09-02   GHS 100   full
  2026-09-03   GHS 100   full
  2026-09-04   GHS 100   full
  2026-09-05   GHS  50   part
  Group A days paid                    4
  B, C, D, E untouched              true      (paid total: 0)

pay a further GHS 50
  day 5 fully covered               true      (amount_paid 100)
  Group A days paid                    5
  B, C, D, E still untouched        true

credit isolation
  Group A credit                       0
  Group B credit                       0
```

---

## Security

| | |
|---|---|
| functions reachable by `anon` | **0** of 29 |
| SECURITY DEFINER without pinned `search_path` | **0** |
| RLS-enabled tables | 19 of 19 |
| credentials in the repository | none |
| IDOR tests against live production | 5/5 |
| financial invariants | 10/10 |

### OUTSTANDING — needs a human, not a deployment

**The admin console password is still `Admin@1234`**, which appears in the
README history and two migrations. Re-confirmed against production during this
phase. Anyone who has read the repository can sign in.

Not rotated here, deliberately: an admin password has to reach a person, and
without a secure channel doing it would lock the operator out of their own
system.

> **Sign in → `/admin/password` → set a long random password.**

Also rotate, as exposed during this engagement: the Supabase Personal Access
Token, the `service_role` key, and the Supabase-issued project JWT secret.
None reached the repository.

---

## Deliberately unresolved

1. **13 unpaid registrations, GHS 1,320.50** — preserved, now with a
   reconciliation workflow offering *fee received* / *waived* / *pursuing*,
   each audited.
2. **402 pending payments, GHS 40,658** — untouched. 364 carry a provider
   reference and need NaloPay's collection report; 34 `REG*` rows have none at
   all, meaning the prompt never reached the provider.
3. **Allocation ordering** — `LEGACY_SLOT_FIRST` preserved exactly.

---

## Not done

- **No real payment has yet run through the new engine.** Everything short of
  moving actual money is verified — preview through the production path, 8-way
  concurrency, 10× replay idempotency, the full acceptance scenario. The first
  live settlement will appear in `settlement_log`. Watch it.
- **Public registration payment.** An applicant still cannot pay their fee
  before approval; the gate currently depends on an admin recording the payment.
  The flow's server side exists; the public payment entry point does not.
- **Admin reconciliation UI.** The endpoint and queue are live; the console
  screen that consumes them is not built.
- **Statement PDF.** Print works; there is no generated PDF.

---

## Where a business rule lives

```
membership rules      src/domain/membership/
contribution rules    src/domain/contribution/
allocation            src/domain/contribution/allocation.ts  (pure)
                      settle_payment()                        (authoritative)
                      bound by conformance.test.ts
money                 src/domain/shared/money.ts              (integer pesewas)
payment rules         src/domain/payment/ + application/use-cases
statements            get_member_statement()
database access       src/infrastructure/supabase/
NaloPay               src/infrastructure/payments/nalopay/ + _shared/nalo.ts
authorization         the use case, and each function's session check
presentation          app/ + components/
```

`src/architecture.test.ts` fails the build if the domain imports a framework,
a database, a payment provider, the clock or the environment — or if any module
grows a runtime schema fallback.
