# Infrastructure

Adapters. This is the **only** layer permitted to know that Supabase, NaloPay
or Africa's Talking exist. Everything here implements a port declared in
`src/application/ports/` — the dependency points inward.

Nothing in this directory is implemented yet. Phase 02 establishes the
boundary; the adapters are written in Phase 03 once the Phase 01 production
outputs confirm what the real schema, indexes and function definitions are.
Writing a repository against a schema we have not verified is exactly the
runtime schema-guessing this rebuild is removing.

```
infrastructure/
  supabase/        SupabaseMemberRepository, SupabaseMembershipRepository,
                   SupabaseContributionRepository, SupabasePaymentRepository,
                   SupabaseMembershipCreditRepository, SupabasePayoutRepository
                   → the only files that import @supabase/supabase-js
                   → convert DECIMAL strings to Money at this edge, once

  payments/
    nalopay/       NaloPayPaymentProvider implements PaymentProvider
                   → the only place channel codes, USSD strings and order ids
                     appear. MTN is 13 when collecting and 1 when paying out;
                     that fact belongs here and nowhere else.

  notifications/   SmsNotificationProvider implements NotificationProvider

  clock/           SystemClock implements Clock
                   → Ghana runs on UTC+0, so `today()` is the UTC date. The
                     legacy flag_late_contributions relies on the same
                     equivalence via CURRENT_TIME; if that ever stops holding,
                     it changes here and in one SQL function, not everywhere.
```

## Rules for anything added here

1. **Convert at the edge.** A repository returns domain types with `Money`,
   never a raw row. `DECIMAL(10,2)` arrives from PostgREST as a *string* —
   pass it to `Money.fromDecimalString`, never `Number()` first.

2. **No schema guessing.** Do not write `if (error.message.includes('column
   ... does not exist')) { retry with fewer columns }`. Nine such fallbacks
   exist in the legacy edge functions and they are why the platform's deployed
   behaviour is environment-dependent. `src/architecture.test.ts` fails the
   build if that pattern appears here.

3. **No business rules.** If a decision about money is being made in this
   layer, it is in the wrong place. Adapters fetch, convert, and write.
