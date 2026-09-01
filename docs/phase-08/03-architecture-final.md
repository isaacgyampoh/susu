# 03 — Architecture, final

```
Presentation          app/**, components/**
      ↓
Application           src/application/**  (use cases, ports)
      ↓
Domain                src/domain/**       (money, allocation, registration, membership)
      ↑
Infrastructure        src/infrastructure/**, supabase/functions/**, supabase/migrations/**
```

The dependency rule is not a diagram. `src/architecture.test.ts` reads the
source and fails the build on a violation — 10 checks, run on every `vitest`.

## What the domain may not touch

Enforced mechanically, by import specifier, across every file under
`src/domain/`:

```
next  ·  react / react-dom  ·  @supabase/*  ·  anything matching /supabase/i
nalo  ·  paystack  ·  node: built-ins  ·  fs / path / http / crypto / os
africas-talking / twilio  ·  @/app, @/components, @/lib
../../application, ../../infrastructure
```

And, separately, the domain may not reach for the clock or the environment:
`Date.now()`, `new Date()`, `process.env`, `window`, `localStorage`, `fetch()`.
Every function takes `asOf` as an argument instead, which is what makes the
3,000-scenario property suite deterministic.

A domain **test** may read a fixture from disk — the conformance suites load
what the real database did. That is the single relaxation, and it is narrow:
every other rule still applies to tests, because a test importing Supabase would
mean the domain really had acquired the dependency.

## The four rules the suite enforces

| Rule | Why it exists |
|---|---|
| domain is framework-independent | it decides where members' money goes; it must run with no database, no HTTP, no provider |
| application depends inward only | a use case may not import a concrete adapter |
| **one settlement engine** | five existed before the rebuild; an edge function may CALL the engine but must not write a contribution to `paid` itself |
| **no runtime schema guessing** | repo-wide, `src/` and `supabase/functions/` alike |
| **a registration fee never reaches the contribution allocator** | it settles no obligation; routing one through `settle_payment()` raises |
| **member endpoints bind every financial read to the caller** | the IDOR rule, as a lint |
| **no `member_id` from a request body** in a member-authenticated function | the classic IDOR |

The onboarding backfill is the single documented exception to the settlement
rule: it **inserts** historical rows an operator states, and settles nothing.

## Where each concern lives

| Concern | Home |
|---|---|
| what a payment covers | `src/domain/contribution/allocation.ts` (pure) and `settle_payment()` (authoritative) |
| what a registration fee settles | `src/domain/registration/settlement.ts` (pure) and `settle_registration_fee()` |
| money arithmetic | `src/domain/shared/money.ts` — integer pesewas, no floating point |
| allocation ordering | `src/domain/contribution/policy.ts` — `LEGACY_SLOT_FIRST` |
| provider details | `supabase/functions/_shared/nalo.ts` — the domain does not know NaloPay exists |
| capability tokens | `supabase/functions/_shared/registration-token.ts` — a platform CSPRNG concern |
| where links point | `supabase/functions/_shared/urls.ts` — configuration, not inference |
| authorization | the edge function boundary: `requireAdmin` / `requireMember`, explicit in all 52 |

## The deliberate duplication, and what makes it safe

The allocation rule exists **twice**: once pure, once in PostgreSQL.

That is not an oversight. The pure one drives the pre-payment preview and is
testable with no database. The SQL one is authoritative because only the
database can lock the rows it is about to change. Removing either would cost
something real.

It is safe only because they are held to each other:

```
conformance.test.ts             16 hand-written scenarios
generated-conformance.test.ts  150 GENERATED scenarios, captured from the real
                                   deployed engine and compared line by line
```

Both fixtures are produced by running the scenario through production inside a
transaction that is rolled back. The generated suite is the stronger of the two:
nobody chose those cases.

## Money

Integer minor units throughout. `Money.fromDecimalString` parses digits
directly, because `Number("10.90") * 100` is `1089.9999999999998`. Rounding is
half-up, matching PostgreSQL, and the conformance suites would fail if it ever
stopped matching.
