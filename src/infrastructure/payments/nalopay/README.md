# NaloPay adapter

NaloPay is the only payment provider. `_shared/mode.ts` records that Moolre and
Paystack were removed deliberately once the business settled on Nalo, "since a
bug could hide in the two nobody ever ran". Do not reintroduce either.

## Legacy naming — investigate before changing

The database still carries `paystack_ref`, `paystack_data` and
`paystack_transfer_ref`. These are archaeology from a provider that is gone.

**Do not rename them as a tidy-up.** `contributions.paystack_ref` is the column
at the centre of finding F-02: three settlement paths write the same reference
across every day a payment covered, and a UNIQUE index may or may not exist on
it in production. A rename waits for `docs/phase-01/01-schema-inventory.sql`
and gets its own migration with its own rollback.

## What belongs here, and only here

- HTTP calls to NaloPay
- Channel codes (MTN is `13` collecting, `1` paying out — same network, two
  numbers, and getting it backwards sends money the wrong way)
- Order-id formats and the 20-character reference limit NaloPay enforces
- USSD strings
- Callback payload shapes

## What does NOT belong here

- Which obligations a payment covers (`domain/contribution/allocation.ts`)
- Whether a payment may settle (`application/use-cases` — VerifyPayment)
- The service-charge percentage (a business rule, not a provider detail)
