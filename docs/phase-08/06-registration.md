# 06 — Registration

## The flow

```
PUBLIC SITE  /join
      ↓  kyc-submit (public)
APPLICATION CREATED             fee computed server-side from susu_groups
      ↓                         capability token issued (hash stored, raw never)
/join/pay/<token>               registration-payment (public, --no-verify-jwt)
      ↓  action=initiate
NALOPAY PROMPT                  transaction written BEFORE the prompt
      ↓  action=verify → NaloPay collection-status
PROVIDER CONFIRMS
      ↓  settle_registration_fee()   ONE transaction, row locked
FEE PAID                        token retired; settlement_log + audit_log
      ↓  ADMIN REVIEW
APPROVAL                        gated on payment
      ↓
MEMBERSHIP ACTIVE
```

An unpaid application cannot become an active paid membership. Approval returns
**402** with the amount owed and two honest ways forward: record the payment
when it arrives, or override with a written reason stored in the audit log. The
override never creates a payment record.

## A partial fee unlocks nothing

```
fee GHS 150, provider confirms GHS 100   →  NOT PAID, NOT ACTIVATED
fee GHS 150, provider confirms GHS 149.99 →  NOT PAID
fee GHS 150, provider confirms GHS 150   →  PAID, awaiting approval
fee GHS 150, provider confirms GHS 152.25 →  PAID, GHS 150 recorded
                                              (the service charge is the processor's)
fee GHS 150, provider confirms GHS 500   →  PAID, GHS 150 recorded
```

There is no representation for a partially registered member, and inventing one
would be guessing at money. A shortfall is logged as `registration_fee_short`
and left for a human.

The previous implementation computed `least(confirmed, recorded)` and then
marked the application paid with whatever came out — GHS 100 bought a GHS 150
registration in full.

## The capability token

```
32 bytes from crypto.getRandomValues, base64url, 43 characters
stored ONLY as SHA-256 — a database reader cannot reconstruct any link
14-day expiry, enforced in SQL by get_registration_public()
retired the moment the fee settles
grants exactly one thing: paying THIS application's fee
```

Eleven automated tests hold it to that: format, 1,000 issues with no repeat,
no positional bias across 500 samples, no shared prefix between consecutive
issues, deterministic hashing, avalanche on a one-character change, agreement
with the SHA-256 the database computes, and rejection of every malformed shape
including SQL-injection and path-traversal strings.

## Fee integrity

The amount comes from `kyc_applications.registration_fee_amount`, computed by
the server from `susu_groups.registration_fee` at submission. The request body
is never consulted for it — `registration-payment` reads exactly four fields:
`token`, `action`, `pay_number`, `pay_network`.

Tested live with a hostile body carrying `amount: 1`, `fee: 1`, and another
applicant's `kyc_id` and `registration_id`: **not one field was honoured**, and
zero transactions were created against the other application.

## Idempotency

Ten replays of one settled payment: `already = true` every time, one
`registration_fee_settled` row, one audit row, one transaction. The lock is
taken before the status is read, so two concurrent callbacks serialise.

## States

Derived from `status`, `registration_fee_paid`, and whether a pending attempt
exists — not stored as one column:

```
awaiting_payment · awaiting_confirmation · under_review · approved · rejected
```

`approved` deliberately does **not** imply paid. The system permits an audited
override, and a model conflating the two would hide exactly the case worth
seeing.

## Historical data — classified, preserved, surfaced

| Population | Value | Classification | Action |
|---|---|---|---|
| 13 approved registrations, fee unpaid | GHS 1,320.50 | **ambiguous** | preserved; surfaced with per-case decisions |
| 7 marked paid, no payment and no audit row | GHS 1,745.00 | **ambiguous** | preserved; surfaced; only action is "record what happened" |
| 402 payments pending over 48h | GHS 40,658.00 | **requires provider evidence** | preserved; only `refresh` can settle one, and only if NaloPay confirms |

None auto-repaired. Nothing in this system can prove what happened to them, and
guessing at a payment status is the one thing that must never happen.

The **path** that produced the seven is closed: `mark_fee_paid` now writes the
transaction and the audit row *first*, and the flag only follows. Invariant 12
fails if it recurs.
