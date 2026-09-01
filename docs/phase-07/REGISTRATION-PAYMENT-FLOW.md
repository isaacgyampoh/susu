# Registration payment — the flow, and what may change its state

## The path

```
PUBLIC SITE  abbiewealthsusu.com/join
      │
      ▼  kyc-submit  (public)
APPLICATION CREATED                    status=pending, registration_fee_paid=false
      │                                fee computed server-side from susu_groups
      │                                payment token issued (hash stored, raw never)
      ▼  redirect + SMS
/join/pay/<token>                      registration-payment  (public, --no-verify-jwt)
      │
      ▼  action=initiate
NALOPAY PROMPT                         transaction row written BEFORE the prompt
      │                                status = pending
      ▼  action=verify  →  NaloPay collection-status
PROVIDER CONFIRMS
      │
      ▼  settle_registration_fee()     ONE transaction, row locked
REGISTRATION FEE = PAID                token retired; settlement_log + audit_log
      │
      ▼  ADMIN REVIEW  (/admin/kyc, "Paid, awaiting review")
APPROVAL                               kyc-review — gated on payment
      │
      ▼
MEMBERSHIP ACTIVE
```

## What may mark a registration paid

Exactly three things, and each leaves a record:

| Route | Evidence | Record written |
|---|---|---|
| `settle_registration_fee()` | NaloPay's status endpoint | `settlement_log` + `audit_log` + a `success` transaction |
| `mark_fee_paid` / `fee_received` | a named admin states money was taken | a real `success` transaction, `audit_log`, reason ≥ 10 chars |
| approval override | a named admin activates without payment | `audit_log` only — **no payment record is created** |

Nothing else. Not the request body, not a callback payload, not a successful
`initiate`.

## The token

- 32 bytes from `crypto.getRandomValues`, base64url, 43 characters.
- Stored **only** as SHA-256. A database reader cannot reconstruct a link.
- 14-day expiry, enforced in SQL by `get_registration_public()`.
- Retired the moment the fee settles, so a settled link cannot start a second payment.
- Grants one capability: paying **this** application's fee.

Lost links are re-issued, never recovered: `/admin/kyc` → *Send link*.

## Fee integrity

The amount comes from `kyc_applications.registration_fee_amount`, which the
server computed from `susu_groups.registration_fee` at submission. The request
body is never consulted — `registration-payment` reads exactly four fields from
it: `token`, `action`, `pay_number`, `pay_network`. There is no amount
parameter and no id parameter to tamper with.

`settle_registration_fee()` compares the provider's confirmed amount against
that figure:

| Provider says | Fee | Outcome |
|---|---|---|
| 150.00 | 150.00 | settled, 150.00 recorded |
| 152.25 (grossed up by the 1.5% service charge) | 150.00 | settled, **150.00** recorded — the charge is the processor's |
| 500.00 | 150.00 | settled, **150.00** recorded |
| 149.99 | 150.00 | **nothing settles.** logged as `registration_fee_short` |
| 100.00 | 150.00 | **nothing settles.** application stays unpaid |

A shortfall has no representation in this schema, and inventing one — a
partially registered member — would be guessing at money. It is logged for a
human instead.

## Idempotency

Proven against production, rolled back: ten replays of one settled payment
produce `already = true` every time, one `registration_fee_settled` row, one
audit row, one transaction.

The lock is taken **before** the status is read, so two concurrent callbacks
serialise rather than race.

## States

Derived, never stored as one column — from `status`, `registration_fee_paid`,
and whether a pending attempt exists:

```
awaiting_payment       applied; fee not received
awaiting_confirmation  a prompt was raised; the provider has not answered
under_review           paid (or no fee due); waiting for a human
approved
rejected
```

`approved` deliberately does **not** imply paid. The system permits an audited
override, and a model that conflated the two would hide exactly the case worth
seeing.
