# Legacy function audit

Every financial code path, classified. Verified against the deployed system.

**Status** — ACTIVE (canonical) · REPLACED · DISABLED · HISTORICAL (legitimate,
not settlement) · DEAD (no caller)

---

## Settlement

| function | purpose | callers now | replacement | status |
|---|---|---|---|---|
| `settle_payment()` | apply money to obligations | all 6 payment paths | — | **ACTIVE — canonical** |
| `settle.ts settlePayment()` | was the algorithm | 3 edge functions | now a thin RPC call | **REPLACED** |
| `payments-verify` batch branch | blanket UPDATE, no allocations | — | `settle_payment()` | **REPLACED** |
| `cron-settle-pending` batch branch | blanket UPDATE | — | `settle_payment()` | **REPLACED** |
| `payments-bulk` dev branch | blanket UPDATE | — | `settle_payment()` | **REPLACED** |
| `payments-initialize` dev branch | direct UPDATE | — | `settle_payment()` | **REPLACED** |
| `payments-manual` bulk | blanket UPDATE | — | directed `settle_payment()` | **REPLACED** |
| `payments-manual` partial | `record_partial_payment()` | — | directed `settle_payment()` | **REPLACED** |
| `record_partial_payment()` | partial instalment | **none** | `settle_payment()` | **DEAD** — retained in DB, no caller |
| `claimTransaction()` | pre-settlement claim | none | lock inside the engine | **DEAD** — stub warns |

## Repair tools — all disabled (HTTP 410)

| function | why it existed | status |
|---|---|---|
| `admin-repair-overpayments` | spread a surplus across groups | **DISABLED** |
| `admin-restore-reversals` | un-reverse payments | **DISABLED** |
| `admin-repair-forced` | reconcile against a pasted NaloPay list | **DISABLED** |
| `admin-reconcile-payments` | mark contributions paid directly | **DISABLED** |

All four moved money outside the engine. They existed to repair F-02, which is
fixed at source (v26) and reconciled with an audit trail (v27). Verified
returning the disabled message in production.

## Aggregation

| code | problem | status |
|---|---|---|
| `admin-dashboard` fetch + `reduce()` | unbounded; **truncated at 1,000 rows** | **REPLACED** by `get_admin_totals()` |
| `member-profile` 6+2N queries | N+1 | **REPLACED** by `get_member_portal_state()` |
| `member-profile` 50/30-row totals | silently wrong past the window | **REPLACED** |

The dashboard figure was understating by **GHS 102,338.50** — it read
GHS 433,110.50 where the truth is GHS 535,449.00. Verified corrected in
production.

## Writes of `status = 'paid'` outside the engine

| location | classification |
|---|---|
| `admin-onboard-member` | **HISTORICAL** — backfills pre-system contributions for onboarded members. Not settlement; legitimate. |
| `payouts-admin` | **HISTORICAL** — marks a *payout* paid, a different object. |
| `admin-members` | **HISTORICAL** — reconciles the payouts row with its membership. |
| `admin-repair-forced` | **DISABLED** — unreachable behind the 410. |

**No active settlement path bypasses `settle_payment()`.**

## Schema fallbacks — all removed

Nine runtime "catch missing column, retry" blocks, confirmed dead (every
migration v1–v24 applied) and deleted: `admin-add-member`,
`admin-onboard-member`, `kyc-review`, `member-join-group`, `groups-public`,
`payments-manual`, `member-profile`, `admin-sms-log`, plus the `admin-members`
hint retained as a message.

`src/architecture.test.ts` fails the build if the pattern reappears.

## Deprecated but retained

| object | why retained |
|---|---|
| `members.credit_balance` | zero for every member; still read in one legacy place. Superseded by `membership_credit_ledger`. |
| `contributions.paystack_ref` | legacy name; the provider is NaloPay. Read by live paths and reports — renaming needs its own migration. |
| `record_partial_payment()` | no caller; left in place until a release confirms nothing external calls it. |
