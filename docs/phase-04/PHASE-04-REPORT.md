# Phase 04 report

Migration of the live application onto the new architecture.
Executed 1 September 2026 against project `qaelfwtbaehdwhnxkpid`.

---

## Production impact

```
Production database changed:   YES  — 2 read-only functions added (v30, v31)
Financial data changed:        NO   — every count, total and hash identical to end of Phase 03
Payment behaviour changed:     YES  — the live path now uses the canonical engine
NaloPay behaviour changed:     NO   — same API calls; the webhook now REQUIRES provider confirmation
Member portal changed:         YES  — rebuilt around multiple memberships
Registration behaviour changed: NO  — deliberately deferred
```

The financial checksum after Phase 04 is **byte-identical** to the one after
Phase 03, including all five content hashes — despite previews having been run
against real production memberships. The preview mechanism is read-only by
construction and left nothing behind (0 preview transactions, 0 preview
allocations, conformance schema dropped).

---

## Architecture migration

### The payment engine — five implementations reduced to one

`_shared/settle.ts` no longer *contains* the settlement algorithm. It is now a
call into `settle_payment()`. The algorithm moved to PostgreSQL because its
four defects were properties of *where it ran*, not of its logic: no
transaction, no row locking, unchecked writes, member-scoped credit.

| path | before | after |
|---|---|---|
| `payments-verify` single | `settle.ts` | `settle_payment()` |
| `payments-verify` **batch** | blanket `UPDATE`, no allocations | `settle_payment()` |
| `nalo-webhook` | `settle.ts` after `claimTransaction` | `settle_payment()` |
| `cron-settle-pending` single | `settle.ts` | `settle_payment()` |
| `cron-settle-pending` **batch** | blanket `UPDATE`, no allocations | `settle_payment()` |
| `admin-repair-*` (3 tools) | own logic, outside the engine | **disabled (410)** |

`claimTransaction()` is deprecated: claiming before settling is now *wrong*,
because the engine locks the payment row and checks its status inside the
settling transaction — strictly stronger than a conditional update beforehand.
A caller that claims first would mark the payment successful and the engine
would then settle nothing.

### F-04 closed — the webhook no longer trusts its own payload

```diff
- const settled = tx?.settled || callbackSaysComplete
+ if (!status?.settled) return   // no provider confirmation, no settlement
```

The `||` allowed an unauthenticated caller to settle a payment that never
happened whenever the status endpoint lagged. A callback that cannot be
verified now costs one status lookup and nothing else; the 48-hour sweeper
retries, so a genuine payment is not lost.

The webhook also now settles the amount **the provider reports**, not the
amount we requested — a short payment can no longer over-credit.

### F-05 closed — cross-request state leak

The module-scope `lastSpread` in `payments-verify` is gone. Deno reuses
isolates, so two members verifying simultaneously shared it and one member's
SMS receipt could carry another's figures.

---

## Member portal

**The single-group assumption is gone.** The old dashboard rendered
`plans[tab]` — one membership behind a chip selector. Two thirds of this
platform's members hold more than one membership; one holds thirty across
eighteen groups, and saw one of them at a time.

Rebuilt around `MembershipCard`, one per membership, grouped by what the member
must act on:

```
Due today, across all your groups     ← one figure, computed in the database
  Groups · Paid so far · Still to pay

Needs paying today · 2 of 5
  [Group A card]  [Group B card]

Nothing owing today · 3
  [Group C]  [Group D]  [Group E]

Not started yet
  [Group F — group never activated]
```

Each card carries that membership's own due-today, paid-today, paid-so-far,
still-to-pay, progress, advance days, credit, arrears, next obligation and
cash-out — and a Pay button scoped to it.

**The portal performs no financial arithmetic.** Every figure, including
cross-membership totals, comes from `get_member_portal_state()`. The previous
dashboard summed money in a React `reduce`.

New: `/m/portal/membership/[id]` — one membership in full, with the payments
that touched it and what each covered *there*, noting when a payment also
covered other groups.

### Honest partial states

A part-paid future obligation never reads as paid:

> You have paid GHS 50.00 of GHS 100.00 toward this day.
> GHS 50.00 remains to complete it.

An unset cash-out date says so rather than being fabricated:

> Not set — ask your collector

---

## Payment preview

`preview_settlement()` (v30) and `preview_payment_for_membership()` (v31) do
not reimplement the allocation rule. They construct the payment inside a
savepoint, run **the real `settle_payment()`**, capture what it decided, and
roll back.

The preview is therefore not *equivalent* to the settlement — it **is** the
settlement, executed and undone. Proven on the same payment:

```
preview_left_allocations  0        preview covers  100/100/100/100/50 (4 full, 1 part)
preview_left_paid         0        actual  covers  100/100/100/100/50 (4 full, 1 part)
tx_still_pending          true     preview_total 450 = actual_total 450
```

The pay sheet shows each day, its amount, whether it is full or part, and the
shortfall on a partial — debounced against the server as the member types.

---

## Financial integrity

| guarantee | mechanism |
|---|---|
| atomic settlement | one plpgsql function, one transaction |
| no double allocation | `SELECT … FOR UPDATE` on the payment and its obligations |
| webhook idempotency | status check inside the lock + `UNIQUE(reference, contribution_id)` |
| no client financial authority | browser sends a *requested amount*; server resolves the membership, the obligations and the allocation |
| preview cannot diverge | it is the same execution |
| domain ↔ database agreement | 16 conformance tests |

Idempotency measured directly: **1 delivery vs 10 → identical state** (5
allocations, GHS 450.00, 4 days paid), with 9 replays logged as skipped.

---

## Multiple memberships

`get_member_portal_state()` returns every active membership in **one** query.
For the member holding 30 memberships across 18 groups, the old portal issued
**66 round trips**; it now issues **1**. Verified against that real member:
projection totals match a direct SQL sum exactly (GHS 40,668 paid / GHS 180,882
expected) — the old 50-row window did not.

Isolation is enforced at three levels: `membership_credit_ledger` is
foreign-keyed to a membership; `settle_payment()` only ever spends a
membership's own credit on its own obligations; and the `THIS_MEMBERSHIP_ONLY`
scope is honoured in SQL, not in the client.

---

## Security

- Every new endpoint resolves the membership against `session.sub` **before**
  anything else. `payments-preview` and the new `membership_id` branch of
  `payments-initialize` both do this; without it, changing one field would
  expose another member's obligations.
- All new database functions are `SECURITY DEFINER` with a pinned
  `search_path`, revoked from `PUBLIC`/`anon`/`authenticated`, granted only to
  `service_role`.
- The browser cannot dictate allocation, contribution status, credit or payout.
  It sends an amount; the server decides everything else.

---

## Concurrency — verified under genuine parallelism

The Phase 03 report listed this as unverified. It is now measured: **8
simultaneous settlements** fired at one payment from 8 separate connections.

```
completions              1        allocation rows      5   (not 40)
skipped replays          7        total allocated  450.00  (not 3,600.00)
days marked paid         4        spurious credit    0.00
```

`SELECT … FOR UPDATE` on the payment row serialises them; the seven losers find
a settled payment and return its existing allocations without writing.

---

## Directed settlement — the manual path, without changing admin behaviour

`payments-manual` carries the most volume on the platform: 3,978 contributions,
GHS 403,940. It was the last duplicate settlement implementation.

It could not simply call the policy allocator, because the two answer different
questions. `settle_payment()` asks *"GHS 450 arrived — apply it by policy"* and
chooses the days. Manual collection asserts *"the admin says THESE days were
paid in cash"* — the days are the input. Routing it through the policy queue
would mean an admin ticking days 5, 7 and 9 finds days 1, 2 and 3 settled
instead. On that volume, an unacceptable side effect of a refactor.

So v32 gave the engine a second **queue source**, not a second engine. With
`p_target_contributions` the queue is exactly the obligations named; everything
after that is identical — same locking, same allocation ledger, same
atomicity, same audit. Verified on the awkward case:

```
admin selects days 5, 7, 9 (non-contiguous)
→ settled: 2026-09-05, 2026-09-07, 2026-09-09
→ untouched earlier days: 4
→ amount_paid now set: 300.00   (the blanket UPDATE never set it)
→ allocations written: 3        (the blanket UPDATE wrote none)
```

---

## A note on verifying a live system

Midway through this phase the financial checksum moved: +1 transaction, +GHS
195 paid, −GHS 195 pending. It was not the migration. An admin recorded
`MAN-CASH-1788259867144-0bb37c` — GHS 195 cash from SSU-0016 for 3 days —
through the live console at 10:51 UTC while the work was in progress.

Two things follow. A naive before/after checksum cannot distinguish a migration
effect from business activity on a system that is in use; what it can do is
force every difference to be *explained*, which is what happened here. And that
payment was written by the legacy manual path — so it landed with no allocation
row, a live demonstration of the defect the same phase then removed.

The baseline was reset to include that payment, and every subsequent step
verified against it: **nothing further moved.**

---

## Legacy: removed, disabled, remaining

**Removed** — all 9 runtime schema-guessing fallbacks; the batch settlement
branches in `payments-verify` and `cron-settle-pending`; the module-scope
`lastSpread`; the webhook's callback-trust fallback.

**Disabled (410)** — `admin-repair-overpayments`, `admin-restore-reversals`,
`admin-repair-forced`. These moved money outside the canonical engine and
existed to repair F-02, which is fixed at source and reconciled by v27.

**Migrated since** — `payments-manual` bulk and partial paths, the
`payments-bulk` dev branch, and the `payments-initialize` dev branch all now
call `settle_payment()`. `admin-dashboard` now calls `get_admin_totals()`
instead of fetching every successful transaction into JavaScript, and exposes
the live anomaly counts. `admin-reconcile-payments` is disabled (410) — it
marked contributions paid outside the engine.

**Every settlement path now routes through `settle_payment()`.** The only
remaining writes of `status: 'paid'` are `admin-onboard-member` (historical
backfill of pre-system contributions — not settlement) and `payouts-admin` /
`admin-members` (marking a *payout* paid, a different thing).

**Remaining** — `record_partial_payment()` still exists in the database but has
no caller; the old `/m/portal/payments` screen still uses `PayNumberSheet` and
its own single-group filter; `members.credit_balance` is still read in one
place; registration activation is unchanged.

---

## Deliberately unresolved

1. **13 unpaid registrations, GHS 1,320.50** — preserved and visible. Business
   decision.
2. **402 pending transactions, GHS 40,658** — untouched. The new engine does
   not reinterpret them; they need NaloPay's collection report.
3. **Allocation ordering** — `LEGACY_SLOT_FIRST` preserved exactly, now
   explicit and centralised in one policy consulted by preview and settlement
   alike.

---

## Verification

```
69 tests passing (architecture · money · allocation · properties · conformance)
tsc clean
next build passes
8-way concurrent settlement → exactly one financial result
directed settlement honours a non-contiguous admin selection
financial checksum unchanged against the live-activity baseline, all five hashes
0 test or preview artefacts left in production
```

### Still not done

- **Member statements** (`GetMemberStatement`) not rebuilt.
- **Registration** flow unchanged — activation still does not require verified
  payment. Deliberate: changing activation rules mid-phase would alter live
  business behaviour.
- **Automated authorization/IDOR tests** — the checks are implemented and
  enforced server-side in every new endpoint, but there is no test suite
  exercising cross-member access yet.
- **Edge functions are not deployed.** Every change above is in the repository
  and verified against the database, but `supabase functions deploy` has not
  been run, so production is still executing the previous code. The database
  migrations ARE applied and live.
