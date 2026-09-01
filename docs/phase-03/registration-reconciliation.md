# Registration reconciliation

**Status: REQUIRES_BUSINESS_DECISION. No member was suspended, invoiced or
written off. No fee was altered.**

---

## The gap

`kyc-review`'s `approve` branch creates the member with `status: 'active'` and
inserts memberships, payout positions and payout rows **without ever reading
`registration_fee_paid`**. Marking the fee paid is a separate, optional admin
action.

## Confirmed in production

- **19** approved applications
- **13** approved with the registration fee unpaid — **GHS 1,320.50**
- **5** of those produced a member who is still `active`

## The affected records

Full detail in `docs/phase-03/reconciliation-data.json`. Summary:

| member | name | fee | member status | memberships |
|---|---|---|---|---|
| SSU-0033 | Christiana Adjei | GHS 602.00 | **active** | 5 |
| SSU-0034 | Lisa naa Quaye | GHS 102.00 | suspended | 2 |
| SSU-0036 | Racheal Liongo Mordey | GHS 11.00 | suspended | 1 |
| SSU-0076 | Ayinyata Priscilla | GHS 195.00 | suspended | 1 |
| SSU-0078 | Susana Bankole | GHS 23.00 | suspended | 1 |
| — | Gifty Ofori | GHS 23.00 | no member created | 0 |
| *(7 more)* | | | | |

Worth noting: **most are already suspended**, which suggests the operator has
been handling this informally. The live exposure is narrower than the headline
— principally **SSU-0033, GHS 602.00, active with 5 memberships**.

## Decision required

Three options, none of which I will take:

1. **Suspend** the remaining active members until the fee is paid.
2. **Invoice** — create a `registration_fee` transaction and let them pay
   through the portal.
3. **Write off** where the amount is immaterial or the member has since been
   handled another way.

This is a customer-relationship decision, not a data-integrity one.

## The architectural fix (implemented, not yet enforcing)

The target flow, encoded in `src/application/use-cases` as `ActivateMembership`:

```
registration submitted
   → registration fee payment
   → payment verified by the provider
   → registration approved
   → membership created and activated
```

with an explicit, audited administrative override for the cases where an
operator legitimately activates before payment.

**Not yet wired into `kyc-review`.** Changing activation rules mid-phase would
alter live business behaviour, which Phase 03 forbids. It is the first item of
the registration phase.
