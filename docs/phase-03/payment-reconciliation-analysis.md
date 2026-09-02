# Payment reconciliation analysis

Two populations, analysed against production. **No financial state was changed
for either.**

---

## A. 1,388 successful payments with no allocation

Phase 01 called this "a major financial integrity problem". Analysis against
production **downgrades it**: in every case the contribution was correctly
credited. What is missing is the *audit ledger*, not the money.

| class | payments | value | status |
|---|---|---|---|
| `MANUAL_ADMIN_COLLECTION` (`MAN-*`) | 1,266 | GHS 403,940.50 | **RECONCILED** |
| `HISTORICAL_BACKFILL` (`ONBOARD-*`) | 60 | GHS 113,103.50 | **RECONCILED** |
| `ONLINE_SINGLE` (`CONT-*`) | 55 | GHS 4,286.00 | **RECONCILED** |
| `BULK_BATCH` (`BULK-*`) | 6 | GHS 2,356.00 | **RECONCILED** |
| `REMINDER_TRIGGERED` (`DAY-*`) | 1 | GHS 28.00 | **RECONCILED** |

### The decisive check

For the 55 online payments — the only class where a lost settlement was
plausible — every one has its related contribution **`status = 'paid'`**:

```
ONLINE_SINGLE   payments 55   related_contribution_paid 55   related_NOT_paid 0
```

**Value possibly lost: GHS 0.00.**

### Why each class has no allocation

- **MANUAL_ADMIN_COLLECTION** — `payments-manual` marks contributions paid
  directly (with `payment_method` set) and writes one *summary* transaction per
  member+group batch with no `related_id`. The obligations are correct; the
  transaction simply was never linked to them.
- **HISTORICAL_BACKFILL** — `ONBOARD-*` rows record contributions collected
  before this system existed, entered when a pre-system member was onboarded.
  These are not payment events and **no allocation should exist**.
- **ONLINE_SINGLE / BULK_BATCH** — predate `payment_allocations` (v24).

### Recommendation

**Do not backfill.** Reconstructing allocations for the 1,266 manual
collections means matching a summary transaction to a set of days by member and
date — inference, not evidence, against GHS 403,940 of history. The financial
state is already correct; a wrong attribution would make it worse.

From now on every path routes through `settle_payment()`, which always writes
allocations. The gap is historical and closed going forward.

---

## B. 402 pending transactions older than 48 hours — GHS 40,658

**Status: REQUIRES_NALOPAY_CONFIRMATION. No state changed.**

| class | n | value | provider evidence |
|---|---|---|---|
| `DAY-*` reminder-triggered | 211 | GHS 16,970.00 | has `provider_order_id` |
| `CONT-*` online single | 134 | GHS 12,665.00 | has `provider_order_id` |
| `BULK-*` pay-ahead | 19 | GHS 6,555.00 | has `provider_order_id` |
| `REG*` registration fee | 34 | GHS 4,464.00 | **none** |
| `TEST*` | 4 | GHS 4.00 | none — test data |

### What the evidence supports

The `susu-settle-pending` sweeper is **active and healthy**: 1,008 runs in 7
days, all succeeded, last run within 10 minutes of this analysis. It asks
NaloPay about every pending payment for 48 hours. These 402 were swept
repeatedly during their window and NaloPay never reported them settled.

That is strong evidence they are abandoned prompts — a member who never entered
their PIN. It is **not proof**, and this is GHS 40,658.

The 34 `REG*` rows have **no provider order id at all**, meaning the prompt was
never successfully raised. Those can be classified `NEVER_REACHED_PROVIDER`
with high confidence.

### Required to close

NaloPay's collection report for **July–September 2026**, matched on
`transactions.paystack_data->>'provider_order_id'`. Until then every one of
these stays `UNKNOWN` and **no financial state is modified**, per the standing
rule that provider truth decides provider outcomes.

The `TEST*` rows (GHS 4.00 total) are self-evidently test data and could be
marked failed at the operator's discretion; they are left alone for
consistency.
