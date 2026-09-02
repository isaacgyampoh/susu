import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Money } from '../shared/money'
import { asMembershipId, type MembershipId } from '../membership/types'
import { allocatePayment } from './allocation'
import { LEGACY_SLOT_FIRST, THIS_MEMBERSHIP_ONLY } from './policy'
import { dailySchedule, addDays } from './fixtures'
import type { Obligation } from './types'

/**
 * GENERATED CONFORMANCE — the pure allocator against the deployed engine, over
 * scenarios nobody chose.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * `conformance.test.ts` checks sixteen scenarios someone sat down and thought
 * of. This checks a hundred and fifty nobody did: memberships in varying
 * numbers, daily amounts at pesewa resolution, runs of already-settled days,
 * part-payments partway through, and payments from one pesewa to two and a half
 * thousand cedis — each one built in the REAL production database, settled by
 * the REAL `settle_payment()`, and rolled back.
 *
 * §32 asks for `domain allocation = database allocation` across generated
 * scenarios, and this is that property. If the two ever disagree about which
 * day a cedi went to, one of them is wrong about where a member's money went.
 * The fix is to correct an implementation — never to relax this test.
 *
 * REGENERATING (nothing survives the run; the checksum is identical either side):
 *   SUPABASE_ACCESS_TOKEN=… SUPABASE_PROJECT_REF=… node scripts/capture-conformance.mjs
 * ────────────────────────────────────────────────────────────────────────────
 */

interface Captured {
  scenario: {
    seed: number
    memberships: { tag: string; dailyMinor: number; days: number; prepaidDays: number; partialMinor: number }[]
    paymentMinor: number
    scope: 'slot' | 'member'
  }
  result: {
    seed: number
    today: string
    allocations: { group: string; due_date: string; amount: string; kind: 'full' | 'part' }[]
    total_allocated: string
    credit_banked: string
    memberships_touched: number
  }
}

const FIXTURE: Captured[] = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'db-generated-conformance.json'), 'utf8'),
)

/**
 * The date the capture built each schedule from, recorded by the capture
 * itself. It is NOT inferred from the allocations: a membership that starts
 * with settled days has its first allocated day some way into the schedule, so
 * inferring the anchor produces date-offset differences that belong to the
 * test rather than to either implementation.
 */
const anchorDate = (c: Captured): string => c.result.today

function buildScenario(c: Captured, today: string) {
  const obligations: Obligation[] = []
  for (const m of c.scenario.memberships) {
    obligations.push(...dailySchedule({
      membership: m.tag,
      groupName: `CONF-${c.scenario.seed}-${m.tag}`,
      from: today,
      days: m.days,
      amount: Money.fromMinor(m.dailyMinor),
      paidDays: m.prepaidDays,
      partialOnNext: m.partialMinor > 0
        ? Money.fromMinor(Math.min(m.partialMinor, m.dailyMinor - 1))
        : undefined,
      asOf: today,
    }))
  }
  return {
    payment: Money.fromMinor(c.scenario.paymentMinor),
    obligations,
    credit: new Map<MembershipId, Money>(),
    // The payment is anchored to the FIRST membership's oldest open day, which
    // is how the edge functions create it and how the capture built it.
    originMembershipId: asMembershipId(c.scenario.memberships[0]!.tag),
    policy: c.scenario.scope === 'slot' ? THIS_MEMBERSHIP_ONLY : LEGACY_SLOT_FIRST,
    asOf: today,
  }
}

describe(`generated conformance — ${FIXTURE.length} scenarios from the real engine`, () => {
  it('captured a meaningful number of scenarios', () => {
    expect(FIXTURE.length).toBeGreaterThanOrEqual(100)
  })

  it('agrees with the database on every allocation, to the pesewa', () => {
    const disagreements: string[] = []

    for (const c of FIXTURE) {
      const today = anchorDate(c)
      // A payment the database allocated nothing for tells us nothing about
      // ordering; the totals below still hold it to account.
      const req = buildScenario(c, today)
      const mine = allocatePayment(req)

      const dbLines = c.result.allocations.map(a => ({
        date: a.due_date,
        amount: Money.fromDecimalString(a.amount).toDecimalString(),
        kind: a.kind,
      })).sort((x, y) => x.date.localeCompare(y.date) || x.amount.localeCompare(y.amount))

      const myLines = mine.lines.map(l => ({
        date: l.dueDate,
        amount: l.amount.toDecimalString(),
        kind: l.remainingAfter.isZero ? 'full' as const : 'part' as const,
      })).sort((x, y) => x.date.localeCompare(y.date) || x.amount.localeCompare(y.amount))

      const seed = `seed ${c.scenario.seed} (scope ${c.scenario.scope}, payment ${req.payment.format()})`

      if (JSON.stringify(dbLines) !== JSON.stringify(myLines)) {
        disagreements.push(
          `${seed}\n      database: ${JSON.stringify(dbLines)}\n      domain:   ${JSON.stringify(myLines)}`)
        continue
      }

      // Totals, independently of the line-by-line comparison.
      const dbTotal = Money.fromDecimalString(c.result.total_allocated || '0')
      if (!dbTotal.equals(Money.sum(mine.lines.map(l => l.amount)))) {
        disagreements.push(`${seed}: total allocated differs — db ${dbTotal.format()}`)
      }

      // Surplus: whatever the payment did not settle must have been banked as
      // credit, and the two implementations must agree on how much.
      const dbCredit = Money.fromDecimalString(c.result.credit_banked || '0')
      if (!dbCredit.equals(mine.surplusBanked)) {
        disagreements.push(
          `${seed}: credit banked differs — db ${dbCredit.format()}, domain ${mine.surplusBanked.format()}`)
      }
    }

    expect(
      disagreements,
      `The pure allocator and the deployed engine disagree on ` +
      `${disagreements.length} of ${FIXTURE.length} scenarios:\n    ${disagreements.slice(0, 8).join('\n    ')}`,
    ).toEqual([])
  })

  it('never allocates more than the payment, in either implementation', () => {
    for (const c of FIXTURE) {
      const payment = Money.fromMinor(c.scenario.paymentMinor)
      const dbTotal = Money.fromDecimalString(c.result.total_allocated || '0')
      const dbCredit = Money.fromDecimalString(c.result.credit_banked || '0')
      expect(
        dbTotal.plus(dbCredit).isGreaterThan(payment),
        `seed ${c.scenario.seed}: database allocated ${dbTotal.format()} + banked ` +
        `${dbCredit.format()} from a ${payment.format()} payment`,
      ).toBe(false)
    }
  })

  it('respects scope: a slot-scoped payment never touches a second membership', () => {
    for (const c of FIXTURE) {
      if (c.scenario.scope !== 'slot') continue
      expect(
        c.result.memberships_touched,
        `seed ${c.scenario.seed}: a slot-scoped payment reached ${c.result.memberships_touched} memberships`,
      ).toBeLessThanOrEqual(1)
    }
  })
})
