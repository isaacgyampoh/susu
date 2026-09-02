# Final checksum

`docs/phase-03/financial-checksum.sql` is re-runnable at any time. It captures
row counts, per-state money totals, per-group totals, and MD5 content hashes
over the financial columns of contributions, allocations, transactions, payouts
and memberships.

Row counts alone do not prove data was preserved — a migration can keep every
row and still move money. The hashes are what make preservation checkable.

## Phase 05 result

| | before deployment | after deployment + live testing |
|---|---|---|
| every row count | — | **unchanged** |
| every money total | — | **unchanged** |
| all five content hashes | — | **unchanged** |

**No financial difference across the entire cutover.** Deployment was
code-only, as planned, and every live production test (preview, IDOR, admin
dashboard, member portal) was read-only.

## Cumulative — audit start to now

| figure | at audit | now | change |
|---|---|---|---|
| members | 82 | 82 | — |
| groups | 18 | 18 | — |
| memberships | 266 | 266 | — |
| contributions | 15,707 | 15,707 | — |
| transactions | 1,924 | 1,925 | +1 *(live admin cash collection)* |
| allocations | 181 | 181 | — |
| payouts | 153 | 153 | — |
| contributions paid | 530,260.00 | 530,678.00 | +418.00 |
| contributions pending | 558,484.00 | 558,066.00 | −418.00 |

Every difference is accounted for:

- **+GHS 223.00 / −GHS 223.00** — the v27 F-02 reconciliation. Four days a
  member had paid for but was still being billed for. Money conserved; nothing
  created. Four `audit_log` rows record it.
- **+GHS 195.00 / −GHS 195.00, +1 transaction** — `MAN-CASH-1788259867144-0bb37c`,
  a real cash collection recorded by an admin at 10:51 UTC on 1 September while
  this work was in progress. Legitimate business activity, not a migration
  effect.
- **GHS 130.00** now sits in `membership_credit_ledger` — a duplicate payment
  recovered for SSU-0012, attached to the membership that was overpaid.

## A note on checksums against a live system

A before/after comparison cannot, by itself, distinguish a migration effect
from a business transaction. What it *can* do is force every difference to be
explained. That happened twice in this project, and on both occasions the
explanation was found in the data rather than assumed.

The corollary: an unexplained difference is the signal. Never accept one.
