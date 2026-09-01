# Production verification

Everything here was run against `qaelfwtbaehdwhnxkpid` on 1 September 2026.
Tests that create data run inside a transaction that is rolled back, so nothing
survives them.

## Test suite

```
src/architecture.test.ts                      10 passed
src/domain/shared/money.test.ts               18 passed
src/domain/contribution/allocation.test.ts    26 passed
src/domain/contribution/conformance.test.ts   16 passed
src/domain/contribution/allocation.properties  3 passed
src/domain/registration/settlement.test.ts    15 passed
src/domain/registration/conformance.test.ts   11 passed
src/infrastructure/security/registration-token 11 passed
                                             ───────────
                                             110 passed

tsc --noEmit    PASS
next build      PASS
```

### The registration conformance suite earned its place immediately

The pure rule in `src/domain/registration/settlement.ts` and
`settle_registration_fee()` in PostgreSQL implement the same rule twice, on
purpose. The fixture is captured by running ten scenarios through the **real**
database function and rolling back.

The pure rule was first written to forgive a one-pesewa shortfall. The database
forgives none. The capture disagreed on `GHS 149.99 against a GHS 150.00 fee`
and the pure rule was wrong. That is the entire reason the suite exists, and it
found the discrepancy before anything shipped.

## §44 acceptance — 19/19

`docs/phase-07/acceptance-multi-group.sql`, run against production, rolled back.
A member in five groups (100 / 150 / 50 / 200 / 75 per day) pays GHS 450 into
Group A:

```
PASS  A: days settled by GHS 450                     4 full + 1 part
PASS  A: amounts covered, in order                   100,100,100,100,50
PASS  A: paid total                                  450.00
PASS  B/C/D/E: total paid                            0.00
PASS  B/C/D/E: days marked paid                      0
PASS  B/C/D/E: allocations received                  0
PASS  GHS 50 completes day 5                         1 full
PASS  A: five days now fully paid                    5
PASS  A: nothing part-paid left over                 0
PASS  payment history: both payments listed
PASS  C: 20 part-pays C's first day                  20.00
PASS  A unaffected by C's payment                    500.00
PASS  statement reconciles, all 5 groups             true
PASS  statement lists all 5 memberships              5
PASS  cash-out date not fabricated                   true
PASS  cash-out amount is the group's configured figure
PASS  reversal restores the day                      true
PASS  reversal leaves no live allocation on an unpaid day
PASS  reversal preserved the allocation row          true
```

## Registration settlement — captured from production

| scenario | fee | provider says | settled | short | recorded |
|---|---|---|---|---|---|
| exact payment | 150.00 | 150.00 | yes | no | 150.00 |
| grossed up by service charge | 150.00 | 152.25 | yes | no | **150.00** |
| one pesewa short | 150.00 | 149.99 | **no** | yes | — |
| a third short | 150.00 | 100.00 | **no** | yes | — |
| massively short | 150.00 | 1.00 | **no** | yes | — |
| generous overpayment | 150.00 | 500.00 | yes | no | **150.00** |
| replayed after settling | 150.00 | 152.25 | yes | already | 150.00 |
| small fee, exact | 1.00 | 1.00 | yes | no | 1.00 |
| large fee, exact | 995.00 | 995.00 | yes | no | 995.00 |
| large fee, short by one cedi | 995.00 | 994.00 | **no** | yes | — |

Ten replays of a settled payment: `already = true` every time, one
`registration_fee_settled` row, one audit row, one transaction.

## The first real payments through the new engine

`settlement_log` was empty when this phase began.

```
19:05:36  GHS   102.00 →  1 day   1 group    Sandra kyeremeh
19:06:08  GHS   204.00 →  2 days  2 groups   Dufie Juliet kyere
19:06:54  GHS   102.00 →  1 day   1 group    Gifty Williams
19:06:54  GHS    65.00 →  1 day   1 group    Gifty Williams
19:06:55  GHS   110.00 →  2 days  2 groups   Gifty Williams
19:10:04  GHS   612.00 →  6 days  2 groups   Gloria Konadu
19:10:05  GHS   770.00 → 10 days  1 group    Gloria Konadu
19:10:32  GHS   220.00 →  4 days  1 group    Jemima Kwaley Quartey
19:11:01  GHS   918.00 →  9 days  1 group    Adelaide Darkoah
19:11:39  GHS   231.00 →  3 days  1 group    Esther Naa Lamptey
19:11:50  GHS   102.00 →  1 day   1 group    Lawrencia adjei twum
19:12:37  GHS   510.00 →  5 days  5 GROUPS   Sarah Acheampomaah
20:06:05  GHS  1020.00 → 10 days  2 groups   Christiana Adjei
21:08:18  GHS   102.00 →  1 day   1 group    Faustiana Yaa
21:09:01  GHS   306.00 →  3 days  1 group    Gloria Konadu
21:09:51  GHS   204.00 →  2 days  1 group    Sarah Acheampomaah
21:15:20  GHS   306.00 →  3 days  1 group    Sarah Acheampomaah
                ────────
                5,884.00 across 64 days, 17 payments
```

Every one allocated **exactly** what was paid. These are admin-recorded manual
collections (`MAN-CASH` / `MAN-MOMO`) settling through `settle_payment()` — the
settlement half of the chain, on real money. The NaloPay verification half is
exercised by the conformance suite and the live failure tests, not yet by a
real customer-initiated payment.

### The cutover is visible in the data

The Phase 06 redeploy landed at about 14:00 UTC on 1 September. Every settled
contribution payment either side of that moment:

```
before 14:00 UTC   36 settled payments    0 with allocations   (0%)
after  14:00 UTC   17 settled payments   17 with allocations   (100%)
```

That is the cutover, drawn by the data rather than asserted. It is also why
financial invariant 9 carries the cutoff `2026-09-01 14:00:00+00`: requiring an
allocation for a payment settled before the ledger existed would flag 36
historical rows as defects.

The three most recent pre-cutover payments were checked individually. Each
marked exactly the number of days its description claims — 2, 15 and 3 — so no
money was lost. Their `amount_paid` is 0 because the legacy path set `status`
without it. **That has not been backfilled**: reconstructing which cedi covered
which day would be guessing at historical attribution. It is what the
statement's `attribution_complete: false` exists to say.

### §16 checks on all seventeen

```
allocations whose membership is another member's        0
allocations whose contribution is another membership's  0
full allocations whose day is not marked paid           0
days where amount_paid exceeds amount                   0
paid days with no paid_at                               0
duplicate (reference, day) allocations                  0
settlements logged more than once                       0
transactions not marked success                         0
allocated total differs from the payment                0
```

## Statements

```
memberships touched by a live settlement    47 / 47 reconcile
all memberships, all active members        190 / 190 reconcile
```

The identity, stated on the page rather than summarised:

```
opening + fell due − settled − covered in advance = closing
```

## §35 performance — with statistics

One RPC per screen, whatever a member holds.

| memberships | obligation rows | portal | statement | statement per membership |
|---|---|---|---|---|
| 1 | 60 | 7.7 ms | 9.5 ms | 9.50 |
| 5 | 300 | 5.1 ms | 10.7 ms | 2.14 |
| 18 | 1,080 | 8.3 ms | 23.8 ms | 1.32 |
| 30 | 1,800 | 10.1 ms | 37.4 ms | 1.25 |
| 50 | 3,000 | 15.5 ms | 64.7 ms | 1.29 |

Per-membership cost is flat. Production's largest real member holds **30**
memberships and 2,421 obligations; their live figures match the synthetic ones:

```
portal, 30 memberships                18.6 ms
statement, 30 days                    32.6 ms
statement, 12 months                  41.0 ms
admin dashboard totals                19.8 ms
reconciliation queue (402 payments)   21.6 ms
registration queue                     3.8 ms
```

The first run of this test reported **808 ms** at 50 memberships. That was the
test, not the query: the synthetic rows had no statistics, so the planner chose
nested loops it would never choose in production. `ANALYZE` was added and the
number fell to 64.7 ms — consistent with the real member's 41 ms.

## §33 schema drift

```
migration files in version control        40
deployed functions                        37
declared in migrations                    37
deployed but NOT in a migration            0
in a migration but not deployed            0
duplicate version numbers                  0
DROP TABLE / TRUNCATE anywhere             0
```

Every `DELETE FROM contributions` in the history sits inside `activate_group()`
and removes only `pending`/`overdue` future rows before regenerating a schedule.
No paid day and no successful transaction is ever deleted.

The drift that did exist was in the **functions**: `moolre-webhook` and
`payments-webhook` were deployed with no source in the repository. Both are now
in git.

## §34 backup and recovery

```
physical backups held    8 (daily)
most recent              2026-09-01 07:48 UTC — before any Phase 07 change
region                   eu-west-1
PITR                     DISABLED
```

Recovery granularity is therefore 24 hours: a mistake at 10:00 can only be
rolled back to 07:48, losing the morning's real payments. Enabling PITR is a
paid add-on and a business decision.

## Checksum

```
before Phase 07          captured 16:58 UTC
after migrations v37–v40 no difference in money, counts or hashes
after all deployments    no difference from pre-deploy
```

The checksum did move once, mid-phase, by GHS 4,966 — the thirteen real
payments above. Classified as **business transaction**, not deployment:
`settlement_log` carries a matching row for each, timestamped while the
migrations were already applied and no function had been redeployed.

## §37 failure modes

```
unauthenticated admin endpoint          401
forged admin bearer token               401  (rejected at the gateway)
unauthenticated member endpoint         401
webhook: garbage payload                200, nothing recorded
webhook: unknown order id               200, nothing recorded
webhook: claims success, no order id    200, nothing recorded
registration: unknown token             404  (identical to malformed and absent)
registration: expired link              410
registration: already paid → initiate   409
registration: hostile body (amount=1, someone else's id)  400 — no field honoured
neutralised webhooks: charge.success    410, nothing recorded
```

After all of it: **0 transactions, 0 allocations, 0 settlements created.**
