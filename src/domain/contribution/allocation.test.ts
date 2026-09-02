import { describe, it, expect } from 'vitest'
import { Money, ghs } from '../shared/money'
import { asMembershipId } from '../membership/types'
import { allocatePayment, previewAllocation, AllocationError } from './allocation'
import { ARREARS_FIRST, LEGACY_SLOT_FIRST, THIS_MEMBERSHIP_ONLY } from './policy'
import { dailySchedule, obligation, creditOf, noCredit, addDays } from './fixtures'

const TODAY = '2026-09-01'
const A = asMembershipId('a')
const B = asMembershipId('b')

/** Default request shape; each test overrides what it cares about. */
const req = (o: Partial<Parameters<typeof allocatePayment>[0]>) => ({
  payment: ghs(0),
  obligations: [],
  credit: noCredit(),
  originMembershipId: A,
  policy: ARREARS_FIRST,
  asOf: TODAY,
  ...o,
})

// ───────────────────────────────────────────────────────────────────────────
describe('allocation — the specified worked examples', () => {
  it('₵100 obligation, ₵100 payment → fully allocated, nothing remaining', () => {
    const r = allocatePayment(req({
      payment: ghs(100),
      obligations: dailySchedule({ membership: 'a', from: TODAY, days: 1, amount: ghs(100) }),
    }))

    expect(r.lines).toHaveLength(1)
    expect(r.lines[0]!.amount.toDecimalString()).toBe('100.00')
    expect(r.lines[0]!.kind).toBe('full')
    expect(r.obligationsSettled).toBe(1)
    expect(r.creditAfter.get(A)?.isZero ?? true).toBe(true)
    expect(r.unallocated.isZero).toBe(true)
  })

  it('₵100 obligation, ₵40 payment → ₵40 allocated, ₵60 still owed', () => {
    const r = allocatePayment(req({
      payment: ghs(40),
      obligations: dailySchedule({ membership: 'a', from: TODAY, days: 1, amount: ghs(100) }),
    }))

    expect(r.lines).toHaveLength(1)
    expect(r.lines[0]!.amount.toDecimalString()).toBe('40.00')
    expect(r.lines[0]!.kind).toBe('part')
    expect(r.lines[0]!.remainingAfter.toDecimalString()).toBe('60.00')
    expect(r.obligationsSettled).toBe(0)
  })

  it('₵100/day, ₵300 payment → three whole days covered', () => {
    const r = allocatePayment(req({
      payment: ghs(300),
      obligations: dailySchedule({ membership: 'a', from: TODAY, days: 10, amount: ghs(100) }),
    }))

    expect(r.obligationsSettled).toBe(3)
    expect(r.lines.map(l => l.dueDate)).toEqual([TODAY, addDays(TODAY, 1), addDays(TODAY, 2)])
    expect(r.lines.every(l => l.kind === 'full')).toBe(true)
    expect(r.creditAfter.get(A)?.isZero ?? true).toBe(true)
  })

  it('₵100/day, ₵250 payment → ₵100, ₵100, then ₵50 against the third day', () => {
    const r = allocatePayment(req({
      payment: ghs(250),
      obligations: dailySchedule({ membership: 'a', from: TODAY, days: 10, amount: ghs(100) }),
    }))

    expect(r.lines.map(l => l.amount.toDecimalString())).toEqual(['100.00', '100.00', '50.00'])
    expect(r.lines.map(l => l.kind)).toEqual(['full', 'full', 'part'])
    expect(r.lines[2]!.remainingAfter.toDecimalString()).toBe('50.00')
    expect(r.obligationsSettled).toBe(2)
  })

  it('₵100/day, ₵450 payment → four whole days and ₵50 toward the fifth', () => {
    const r = allocatePayment(req({
      payment: ghs(450),
      obligations: dailySchedule({ membership: 'a', from: TODAY, days: 10, amount: ghs(100) }),
    }))

    expect(r.lines.map(l => l.amount.toDecimalString()))
      .toEqual(['100.00', '100.00', '100.00', '100.00', '50.00'])
    expect(r.obligationsSettled).toBe(4)
    expect(r.lines[4]!.remainingAfter.toDecimalString()).toBe('50.00')
    // Every pesewa is accounted for.
    expect(r.allocatedFromPayment.toDecimalString()).toBe('450.00')
    expect(r.unallocated.isZero).toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('allocation — partial advance', () => {
  it('tops up a day that is already half covered', () => {
    // Today settled; tomorrow already holds ₵50 of its ₵100.
    const obligations = dailySchedule({
      membership: 'a', from: TODAY, days: 5, amount: ghs(100),
      paidDays: 1, partialOnNext: ghs(50),
    })

    const r = allocatePayment(req({ payment: ghs(50), obligations }))

    expect(r.lines).toHaveLength(1)
    expect(r.lines[0]!.dueDate).toBe(addDays(TODAY, 1))
    expect(r.lines[0]!.amount.toDecimalString()).toBe('50.00')
    expect(r.lines[0]!.kind).toBe('full')
    expect(r.lines[0]!.remainingAfter.isZero).toBe(true)
  })

  it('a further ₵50 leaves the next day at ₵50 of ₵100', () => {
    const obligations = dailySchedule({
      membership: 'a', from: TODAY, days: 5, amount: ghs(100), paidDays: 2,
    })
    const r = allocatePayment(req({ payment: ghs(50), obligations }))

    expect(r.lines[0]!.dueDate).toBe(addDays(TODAY, 2))
    expect(r.lines[0]!.kind).toBe('part')
    expect(r.lines[0]!.remainingAfter.toDecimalString()).toBe('50.00')
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('allocation — membership isolation', () => {
  it('a payment into Group A leaves B, C, D and E untouched', () => {
    const obligations = ['a', 'b', 'c', 'd', 'e'].flatMap(m =>
      dailySchedule({ membership: m, from: TODAY, days: 5, amount: ghs(100) }))

    const r = allocatePayment(req({
      payment: ghs(300),
      obligations,
      originMembershipId: A,
      policy: THIS_MEMBERSHIP_ONLY,
    }))

    expect(r.membershipsTouched).toEqual([A])
    expect(r.lines.every(l => l.membershipId === A)).toBe(true)
    for (const m of ['b', 'c', 'd', 'e']) {
      expect(r.lines.some(l => l.membershipId === asMembershipId(m))).toBe(false)
      expect(r.creditAfter.get(asMembershipId(m))).toBeUndefined()
    }
  })

  it("one membership's credit never settles another's obligation", () => {
    const obligations = [
      obligation({ membership: 'a', dueDate: TODAY, amount: ghs(100) }),
      obligation({ membership: 'b', dueDate: TODAY, amount: ghs(100) }),
    ]
    // B holds ₵100 credit; A holds none. A ₵0 payment must settle B only.
    const r = allocatePayment(req({
      payment: ghs(0),
      obligations,
      credit: creditOf({ b: 100 }),
      originMembershipId: A,
    }))

    expect(r.lines).toHaveLength(1)
    expect(r.lines[0]!.membershipId).toBe(B)
    expect(r.creditConsumed.get(B)!.toDecimalString()).toBe('100.00')
    expect(r.creditConsumed.get(A)).toBeUndefined()
  })

  it('surplus banks against the membership that was paid into, not the member', () => {
    const obligations = [
      obligation({ membership: 'a', dueDate: TODAY, amount: ghs(100) }),
      obligation({ membership: 'b', dueDate: TODAY, amount: ghs(100) }),
    ]
    const r = allocatePayment(req({
      payment: ghs(500),
      obligations,
      originMembershipId: A,
      policy: THIS_MEMBERSHIP_ONLY,
    }))

    // Only A's day was reachable; ₵400 is left and belongs to A alone.
    expect(r.creditAfter.get(A)!.toDecimalString()).toBe('400.00')
    expect(r.creditAfter.get(B)).toBeUndefined()
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('allocation — policy is a decision, not a constant', () => {
  // Same money, same debts, two defensible orderings. Which one production
  // actually follows is unresolved until the Phase 01 outputs arrive, so both
  // are pinned here rather than one being silently adopted.
  const scenario = () => [
    ...dailySchedule({ membership: 'a', from: TODAY, days: 3, amount: ghs(100), asOf: TODAY }),
    ...dailySchedule({ membership: 'b', from: addDays(TODAY, -3), days: 3, amount: ghs(100), asOf: TODAY }),
  ]

  it('LEGACY_SLOT_FIRST pays the origin slot ahead, before another slot’s arrears', () => {
    const r = allocatePayment(req({
      payment: ghs(300), obligations: scenario(), policy: LEGACY_SLOT_FIRST,
    }))
    expect(r.membershipsTouched).toEqual([A])
    expect(r.lines.every(l => l.membershipId === A)).toBe(true)
  })

  it('ARREARS_FIRST clears the older debt in the other slot first', () => {
    const r = allocatePayment(req({
      payment: ghs(300), obligations: scenario(), policy: ARREARS_FIRST,
    }))
    expect(r.membershipsTouched).toEqual([B])
    expect(r.lines.map(l => l.dueDate)).toEqual([
      addDays(TODAY, -3), addDays(TODAY, -2), addDays(TODAY, -1),
    ])
  })

  it('ranking is deterministic regardless of the order rows arrive in', () => {
    const obligations = scenario()
    const forward = allocatePayment(req({ payment: ghs(250), obligations }))
    const reversed = allocatePayment(req({ payment: ghs(250), obligations: [...obligations].reverse() }))
    expect(forward.lines.map(l => l.obligationId)).toEqual(reversed.lines.map(l => l.obligationId))
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('allocation — penalties', () => {
  it('settles the penalty alongside the day when the policy says so', () => {
    const o = obligation({
      membership: 'a', dueDate: addDays(TODAY, -1), amount: ghs(100),
      penalty: ghs(10), status: 'overdue',
    })
    const r = allocatePayment(req({ payment: ghs(110), obligations: [o] }))
    expect(r.lines[0]!.amount.toDecimalString()).toBe('110.00')
    expect(r.lines[0]!.kind).toBe('full')
  })

  it('a payment covering only the contribution leaves the penalty owing', () => {
    const o = obligation({
      membership: 'a', dueDate: addDays(TODAY, -1), amount: ghs(100),
      penalty: ghs(10), status: 'overdue',
    })
    const r = allocatePayment(req({ payment: ghs(100), obligations: [o] }))
    expect(r.lines[0]!.kind).toBe('part')
    expect(r.lines[0]!.remainingAfter.toDecimalString()).toBe('10.00')
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('allocation — edge cases', () => {
  it('a zero payment allocates nothing and is not an error', () => {
    const r = allocatePayment(req({
      payment: ghs(0),
      obligations: dailySchedule({ membership: 'a', from: TODAY, days: 3, amount: ghs(100) }),
    }))
    expect(r.lines).toHaveLength(0)
    expect(r.allocatedFromPayment.isZero).toBe(true)
    expect(r.unallocated.isZero).toBe(true)
  })

  it('a zero payment still applies credit the membership already holds', () => {
    const r = allocatePayment(req({
      payment: ghs(0),
      obligations: dailySchedule({ membership: 'a', from: TODAY, days: 3, amount: ghs(100) }),
      credit: creditOf({ a: 150 }),
    }))
    expect(r.lines.map(l => l.amount.toDecimalString())).toEqual(['100.00', '50.00'])
    expect(r.creditConsumed.get(A)!.toDecimalString()).toBe('150.00')
    expect(r.creditAfter.get(A)!.isZero).toBe(true)
  })

  it('rejects a negative payment', () => {
    expect(() => allocatePayment(req({ payment: ghs(-1) }))).toThrow(AllocationError)
  })

  it('rejects a malformed asOf date', () => {
    expect(() => allocatePayment(req({ payment: ghs(10), asOf: '01/09/2026' }))).toThrow(AllocationError)
  })

  it('skips obligations that are already settled', () => {
    const obligations = dailySchedule({
      membership: 'a', from: TODAY, days: 3, amount: ghs(100), paidDays: 3,
    })
    const r = allocatePayment(req({ payment: ghs(100), obligations }))
    expect(r.lines).toHaveLength(0)
    expect(r.creditAfter.get(A)!.toDecimalString()).toBe('100.00')
  })

  it('banks the whole payment when there is nothing at all to settle', () => {
    const r = allocatePayment(req({ payment: ghs(75), obligations: [] }))
    expect(r.lines).toHaveLength(0)
    expect(r.creditAfter.get(A)!.toDecimalString()).toBe('75.00')
    expect(r.unallocated.isZero).toBe(true)
  })

  it('reports surplus as unallocated when there is no membership to bank it against', () => {
    const r = allocatePayment(req({
      payment: ghs(75), obligations: [], originMembershipId: null,
    }))
    expect(r.unallocated.toDecimalString()).toBe('75.00')
  })

  it('handles fractional-slot amounts without drift', () => {
    // A quarter slot of a GHS 55/day group pays GHS 13.75.
    const daily = ghs(55).times(0.25)
    expect(daily.toDecimalString()).toBe('13.75')
    const r = allocatePayment(req({
      payment: ghs(55),
      obligations: dailySchedule({ membership: 'a', from: TODAY, days: 6, amount: daily }),
    }))
    expect(r.obligationsSettled).toBe(4)
    expect(r.allocatedFromPayment.toDecimalString()).toBe('55.00')
    expect(r.lines.every(l => l.kind === 'full')).toBe(true)
  })

  it('pesewa-level amounts stay exact', () => {
    const r = allocatePayment(req({
      payment: Money.fromDecimalString('0.03'),
      obligations: dailySchedule({
        membership: 'a', from: TODAY, days: 3, amount: Money.fromDecimalString('0.01'),
      }),
    }))
    expect(r.obligationsSettled).toBe(3)
    expect(r.allocatedFromPayment.toDecimalString()).toBe('0.03')
  })
})

// ───────────────────────────────────────────────────────────────────────────
describe('allocation — preview matches what will happen', () => {
  it('describes a ₵450 payment the way the screen should', () => {
    const p = previewAllocation(req({
      payment: ghs(450),
      obligations: dailySchedule({ membership: 'a', from: TODAY, days: 10, amount: ghs(100) }),
    }))

    expect(p.coversDays).toBe(4)
    expect(p.fullyCovers.map(f => f.dueDate)).toEqual([
      TODAY, addDays(TODAY, 1), addDays(TODAY, 2), addDays(TODAY, 3),
    ])
    expect(p.partiallyCovers).toHaveLength(1)
    expect(p.partiallyCovers[0]!.amount.toDecimalString()).toBe('50.00')
    expect(p.partiallyCovers[0]!.shortfall.toDecimalString()).toBe('50.00')
    expect(p.creditAfterPayment.isZero).toBe(true)
  })

  it('a preview and the allocation it previews are the same computation', () => {
    const r = req({
      payment: ghs(237),
      obligations: dailySchedule({ membership: 'a', from: TODAY, days: 8, amount: ghs(55) }),
    })
    expect(previewAllocation(r).result).toEqual(allocatePayment(r))
  })
})
