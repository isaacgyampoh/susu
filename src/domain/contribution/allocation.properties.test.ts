import { describe, it, expect } from 'vitest'
import { Money } from '../shared/money'
import { asMembershipId, type MembershipId } from '../membership/types'
import { allocatePayment } from './allocation'
import { ARREARS_FIRST, LEGACY_SLOT_FIRST, THIS_MEMBERSHIP_ONLY, type AllocationPolicy } from './policy'
import { outstandingOf, type Obligation } from './types'
import { obligation, addDays } from './fixtures'

/**
 * Property-based invariant checking.
 *
 * The worked examples in allocation.test.ts prove the engine handles the cases
 * we thought of. These prove it does not violate its own arithmetic on the
 * cases we did not — several thousand generated scenarios across every policy,
 * with awkward shapes deliberately over-represented: pesewa amounts, obligations
 * already part-paid, credit spread across memberships, payments far larger and
 * far smaller than the debt.
 *
 * No property-testing library is pulled in for this. The generator is thirty
 * lines and seeded, so a failure is reproducible from the seed printed with it
 * — which is the only feature of a framework that would actually matter here.
 */

// Deterministic PRNG (mulberry32) so a failing case can always be replayed.
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const TODAY = '2026-09-01'
const POLICIES: AllocationPolicy[] = [ARREARS_FIRST, LEGACY_SLOT_FIRST, THIS_MEMBERSHIP_ONLY]

interface Scenario {
  payment: Money
  obligations: Obligation[]
  credit: Map<MembershipId, Money>
  originMembershipId: MembershipId | null
  policy: AllocationPolicy
  asOf: string
}

function generate(seed: number): Scenario {
  const rand = rng(seed)
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))

  const memberCount = int(1, 5)
  const memberships = Array.from({ length: memberCount }, (_, i) => `m${i}`)

  const obligations: Obligation[] = []
  for (const m of memberships) {
    const days = int(0, 12)
    // Start anywhere from three weeks back to a week ahead, so overdue,
    // due-today and future all occur.
    const start = addDays(TODAY, int(-21, 7))
    // Amounts include pesewa-level values and fractional-slot results.
    const amountMinor = pick([1, 5, 50, 100, 1375, 5000, 10000, 10900, 5500])
    for (let d = 0; d < days; d++) {
      const dueDate = addDays(start, d)
      const amount = Money.fromMinor(amountMinor)
      // A third of obligations carry prior part-payment; a fifth are settled.
      const roll = rand()
      const amountPaid = roll < 0.2 ? amount
        : roll < 0.5 ? Money.fromMinor(int(0, Math.max(0, amountMinor - 1)))
        : Money.zero()
      obligations.push(obligation({
        id: `${m}-${dueDate}-${d}`,
        membership: m,
        dueDate,
        amount,
        amountPaid,
        penalty: rand() < 0.25 ? Money.fromMinor(pick([100, 500, 1000])) : Money.zero(),
        status: amountPaid.isGreaterOrEqual(amount) ? 'paid' : dueDate < TODAY ? 'overdue' : 'pending',
      }))
    }
  }

  const credit = new Map<MembershipId, Money>()
  for (const m of memberships) {
    if (rand() < 0.4) credit.set(asMembershipId(m), Money.fromMinor(int(0, 30000)))
  }

  return {
    payment: Money.fromMinor(pick([0, 1, 50, 100, 5000, 10000, 45000, 250000])),
    obligations,
    credit,
    originMembershipId: rand() < 0.15 ? null : asMembershipId(pick(memberships)),
    policy: pick(POLICIES),
    asOf: TODAY,
  }
}

const CASES = 3000

describe(`allocation invariants over ${CASES} generated scenarios`, () => {
  it('never violates its arithmetic, whatever the shape of the debt', () => {
    for (let seed = 1; seed <= CASES; seed++) {
      const s = generate(seed)
      let result
      try {
        result = allocatePayment(s)
      } catch (e) {
        throw new Error(`seed ${seed}: allocation threw — ${(e as Error).message}`)
      }

      const ctx = `seed ${seed} (policy ${s.policy.name}, payment ${s.payment.format()})`

      // 1. Every line moves a positive amount.
      for (const l of result.lines) {
        expect(l.amount.isPositive, `${ctx}: non-positive line`).toBe(true)
        expect(l.remainingAfter.isNegative, `${ctx}: over-allocated obligation`).toBe(false)
      }

      // 2. Nothing drawn from the payment beyond the payment.
      expect(result.allocatedFromPayment.isGreaterThan(s.payment), `${ctx}: spent more than paid`).toBe(false)
      expect(result.allocatedFromPayment.isNegative, `${ctx}: negative allocation`).toBe(false)
      expect(result.unallocated.isNegative, `${ctx}: negative unallocated`).toBe(false)

      // 3. THE central invariant: the payment is fully accounted for.
      expect(
        result.allocatedFromPayment.plus(result.unallocated).equals(s.payment),
        `${ctx}: allocated ${result.allocatedFromPayment.format()} + unallocated ` +
        `${result.unallocated.format()} != payment ${s.payment.format()}`,
      ).toBe(true)

      // 4. Lines plus banked surplus are funded by the payment plus credit,
      //    exactly. Independently recomputed here from the credit maps rather
      //    than trusting the engine's own surplusBanked figure.
      const lines = Money.sum(result.lines.map(l => l.amount))
      const creditUsed = Money.sum([...result.creditConsumed.values()])
      const banked = [...result.creditAfter.entries()].reduce((acc, [mid, after]) => {
        const before = s.credit.get(mid) ?? Money.zero()
        const used = result.creditConsumed.get(mid) ?? Money.zero()
        return acc.plus(after.minus(before.minus(used)))
      }, Money.zero())
      expect(
        banked.equals(result.surplusBanked),
        `${ctx}: credit maps say ${banked.format()} was banked, engine reports ` +
        `${result.surplusBanked.format()}`,
      ).toBe(true)
      expect(
        lines.plus(banked).equals(result.allocatedFromPayment.plus(creditUsed)),
        `${ctx}: lines ${lines.format()} + banked ${banked.format()} != ` +
        `payment-part ${result.allocatedFromPayment.format()} + credit ${creditUsed.format()}`,
      ).toBe(true)

      // 5. No obligation absorbed more than it owed.
      const byObligation = new Map<string, Money>()
      for (const l of result.lines) {
        byObligation.set(l.obligationId, (byObligation.get(l.obligationId) ?? Money.zero()).plus(l.amount))
      }
      for (const o of s.obligations) {
        const got = byObligation.get(o.id)
        if (!got) continue
        expect(
          got.isGreaterThan(outstandingOf(o)),
          `${ctx}: obligation ${o.id} owed ${outstandingOf(o).format()}, absorbed ${got.format()}`,
        ).toBe(false)
      }

      // 6. Credit never crosses a membership boundary, and never goes negative.
      for (const [mid, used] of result.creditConsumed) {
        const had = s.credit.get(mid) ?? Money.zero()
        expect(used.isGreaterThan(had), `${ctx}: membership ${mid} overspent its credit`).toBe(false)
      }
      for (const [mid, after] of result.creditAfter) {
        expect(after.isNegative, `${ctx}: membership ${mid} ended with negative credit`).toBe(false)
      }

      // 7. Scope is respected absolutely.
      if (s.policy.scope === 'membership') {
        for (const l of result.lines) {
          expect(
            l.membershipId === s.originMembershipId,
            `${ctx}: a membership-scoped payment reached ${l.membershipId}`,
          ).toBe(true)
        }
      }
    }
  })

  it('is idempotent in the sense that re-running produces identical output', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const s = generate(seed)
      expect(allocatePayment(s)).toEqual(allocatePayment(s))
    }
  })

  it('allocating twice never settles more than was owed in the first place', () => {
    // Applying a payment, then applying the same payment again to the updated
    // obligations, must not exceed the original total debt.
    for (let seed = 1; seed <= 300; seed++) {
      const s = generate(seed)
      if (s.payment.isZero) continue
      const totalOwedBefore = Money.sum(s.obligations.map(outstandingOf))

      const first = allocatePayment(s)
      const applied = new Map(first.lines.map(l => [l.obligationId, l.amount]))
      const updated = s.obligations.map(o => {
        const a = applied.get(o.id)
        return a ? { ...o, amountPaid: o.amountPaid.plus(a) } : o
      })
      const second = allocatePayment({ ...s, obligations: updated, credit: first.creditAfter })

      const settledTotal = Money.sum(first.lines.map(l => l.amount))
        .plus(Money.sum(second.lines.map(l => l.amount)))
      expect(
        settledTotal.isGreaterThan(totalOwedBefore),
        `seed ${seed}: settled ${settledTotal.format()} against a debt of ${totalOwedBefore.format()}`,
      ).toBe(false)
    }
  })
})
