# Architecture

The rebuilt platform lives under `src/`. The legacy application — `app/`,
`components/`, `lib/`, and the Deno edge functions in `supabase/functions/` —
is untouched and still serves production. Nothing here is wired to it yet.

## The dependency rule

Dependencies point inward. Nothing in an inner layer knows an outer one exists.

```
  app/  ·  supabase/functions/          PRESENTATION
              │                          screens, route handlers, HTTP
              ▼
      src/application/                  APPLICATION
        ├─ use-cases/                    orchestration, authorization,
        └─ ports/                        transaction boundaries
              │                          declares the interfaces it needs
              ▼
        src/domain/                     DOMAIN
          ├─ shared/                     business rules. Pure. No I/O.
          ├─ membership/                 Testable with no database and no
          ├─ contribution/               payment provider.
          └─ payment/

     src/infrastructure/                INFRASTRUCTURE
       ├─ supabase/                      implements application/ports
       ├─ payments/nalopay/              the ONLY place Supabase and NaloPay
       ├─ notifications/                 are named
       └─ clock/
              │
              └──────► depends on application/ports + domain
```

`src/architecture.test.ts` enforces this mechanically. A documented boundary
that nothing checks is a diagram; the test is what makes it a boundary. It
fails the build if:

- the domain imports Next, React, Supabase, NaloPay, an SMS provider, a Node
  built-in, or anything from an outer layer
- the domain reads `Date.now()`, `new Date()`, `process.env`, `window`,
  `localStorage` or `fetch` — a domain that reads the clock cannot be tested
  deterministically, which is why every function takes `asOf` as an argument
- the application layer imports a concrete adapter instead of its own port
- any new module grows the "query, catch missing column, retry" pattern that
  makes the legacy system's deployed behaviour environment-dependent

## Why each boundary exists

**Domain is pure** so the rule deciding where members' money goes can be run
in a test in under a millisecond. Previously that rule lived inside a function
whose only exercise was making a real payment.

**Application owns its ports.** The interfaces in `application/ports/` are
declared by the layer that *needs* them, not by the layer that implements them.
That is what lets the payment provider be replaced without the use cases
noticing, and what lets every use case be tested against fakes.

**Infrastructure converts at the edge.** `DECIMAL(10,2)` arrives from PostgREST
as a *string*. It becomes `Money` in the repository and stays `Money`
thereafter. No caller ever receives a number it might do arithmetic on.

## Money

Every amount is an integer number of pesewas. GHS 100.00 is `10000`.

The engine this replaces carried amounts as JavaScript numbers and reconciled
them with `Math.round(x * 100) / 100` after each subtraction — applied
inconsistently, so one path rounded after every step, another never rounded its
subtotal, and a third rounded a fee and then rounded the sum again. Across a
330-day cycle those disagreements produce a balance nobody can reconcile.

The database was always right: `DECIMAL(10,2)` throughout. The defect was only
ever in the layer above it.

Parsing is the dangerous part. `Number("10.90") * 100` is `1089.9999999999998`.
`Money.fromDecimalString` reads the digits and never produces a fractional
intermediate.

## Allocation

`domain/contribution/allocation.ts` is a pure function: given what a member
owes, what credit each membership holds, and what they just paid, it decides
exactly which obligations that money covers.

It exists **twice, deliberately** — the one exception to single-source-of-truth
in this codebase, and it needs justifying:

1. **The pure allocator**, here. It powers the pre-payment preview, so the
   screen that says *"this covers today, tomorrow, and GHS 50 of Wednesday"* is
   running the real rule rather than a second guess.
2. **`settle_payment()` in plpgsql**, to be written in Phase 03. The
   authoritative write, running inside one transaction with the obligation rows
   locked — because only the database can lock rows it is about to change.

They are bound by a conformance test: for a generated corpus of scenarios both
must produce identical allocations. **That test is the contract.** Without it
this is simply two implementations of one rule, which is the disease the
rebuild is treating.

### The policy is data, not a constant

The order in which a payment settles obligations is a business rule with real
money attached, and there are currently two candidates that disagree:

| Policy | Behaviour |
|---|---|
| `LEGACY_SLOT_FIRST` | What static analysis says `_shared/settle.ts` does: clear the originating slot entirely — future days included — before touching another membership's overdue days. |
| `ARREARS_FIRST` | What the specification asks for: overdue everywhere, then today, then future. |
| `THIS_MEMBERSHIP_ONLY` | The member's explicit "pay this group only" choice. |

`settle.ts` claims *"arrears before paying ahead, always"* in its header and
implements the first rule in its queue construction. One of those is wrong.
Which is authoritative is a business decision to be made against the Phase 01
production findings — so both are defined, both are tested, and **neither is
marked canonical**.

## Membership

```
Member ──< Membership >── Group
```

A `Membership` is a **slot**, not a group. One person may hold several slots in
one group, each with its own payout position, schedule and money. There is
deliberately no `Member.groupId` and no `Member.group`: the types make the
wrong model unrepresentable.

Credit belongs to a **membership**, never to a member. `members.credit_balance`
as it exists in production lets a surplus paid into Group A settle Group B's
next obligation, which the specification forbids. The target type is
`MembershipCredit`; **the data migration is deferred** until the Phase 01
financial output shows how existing balances map onto it.

## Testing

```
npm test          # everything
npm run test:domain
npm run test:watch
```

53 tests. The domain needs no setup file, no DOM, no mocks and no database —
if it ever does, a boundary has been broken.

The property suite generates 3,000 scenarios across all three policies and
asserts the invariants on every one: the payment is fully accounted for, no
obligation absorbs more than it owes, credit never crosses a membership
boundary, nothing goes negative. It found a real bug in the balancing invariant
on its first run, at seed 1.

## What is deliberately not here yet

Repository and provider implementations. Phase 02 establishes boundaries
without changing production behaviour; the adapters are written in Phase 03,
once the Phase 01 outputs confirm the real schema, indexes and deployed
function definitions. Writing a repository against a schema we have not
verified would be the same runtime schema-guessing this rebuild exists to
remove.
