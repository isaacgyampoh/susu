import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Money } from '../shared/money'
import { asMembershipId, type MembershipId } from '../membership/types'
import { allocatePayment } from './allocation'
import { LEGACY_SLOT_FIRST, THIS_MEMBERSHIP_ONLY } from './policy'
import { obligation, addDays } from './fixtures'
import type { Obligation } from './types'

/**
 * CONFORMANCE — the pure allocator against the deployed database function.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The allocation rule exists twice: as a pure function here, and as
 * `settle_payment()` in PostgreSQL. That duplication is deliberate — the pure
 * one powers the pre-payment preview, the SQL one is the authoritative write
 * because only the database can lock the rows it is about to change — but it
 * is only SAFE because of this file.
 *
 * The fixture in __fixtures__/db-conformance.json was captured by running each
 * scenario through the REAL `settle_payment()` on the production database
 * inside a transaction that was then rolled back. This test rebuilds the same
 * scenarios in memory, runs the pure allocator, and asserts the two agree on
 * every allocation, to the pesewa.
 *
 * If they disagree, one of them is wrong about where a member's money goes.
 * The correct response is to fix the implementation or formally change the
 * policy in both — never to relax this test.
 *
 * REGENERATING THE FIXTURE
 *   node scripts/capture-conformance.mjs      (requires database credentials)
 * The script installs a harness in an isolated `conformance` schema, runs the
 * matrix, and drops the schema. It leaves no data behind.
 * ────────────────────────────────────────────────────────────────────────────
 */

interface DbScenario {
  scenario: string
  daily: number
  days: number
  paid_days: number
  payment: number
  extra_ms: number
  partial_on_next: number
  scope: string
  result: {
    allocations: { due_date: string; amount: string; kind: 'full' | 'part'; group: string }[]
    credit_after: string
    days_settled: number
    total_allocated: string
    other_memberships_touched: number
  }
}

const FIXTURE: DbScenario[] = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'db-conformance.json'), 'utf8'),
)

const START = '2026-09-01'
const ORIGIN = asMembershipId('ms-origin')

/** Rebuild in memory exactly what the SQL harness built in the database. */
function buildScenario(s: DbScenario) {
  const daily = Money.fromDecimalString(String(s.daily))
  const obligations: Obligation[] = []

  for (let i = 0; i < s.days; i++) {
    const settled = i < s.paid_days
    const amountPaid = settled
      ? daily
      : i === s.paid_days && s.partial_on_next
        ? Money.fromDecimalString(String(s.partial_on_next))
        : Money.zero()
    obligations.push(obligation({
      id: `ms-origin-${addDays(START, i)}`,
      membership: 'ms-origin',
      groupName: 'Conformance Group A',
      dueDate: addDays(START, i),
      amount: daily,
      amountPaid,
      status: settled ? 'paid' : 'pending',
    }))
  }

  // Additional memberships, mirroring the harness's chr(65+j) naming.
  for (let j = 1; j <= s.extra_ms; j++) {
    const ms = `ms-extra-${j}`
    for (let i = 0; i < s.days; i++) {
      obligations.push(obligation({
        id: `${ms}-${addDays(START, i)}`,
        membership: ms,
        groupName: `Conformance Group ${String.fromCharCode(65 + j)}`,
        dueDate: addDays(START, i),
        amount: daily,
        status: 'pending',
      }))
    }
  }

  return {
    payment: Money.fromDecimalString(String(s.payment)),
    obligations,
    credit: new Map<MembershipId, Money>(),
    originMembershipId: ORIGIN,
    policy: s.scope === 'slot' ? THIS_MEMBERSHIP_ONLY : LEGACY_SLOT_FIRST,
    asOf: START,
  }
}

describe('conformance — pure allocator vs deployed settle_payment()', () => {
  it('has a fixture captured from the live database', () => {
    expect(FIXTURE.length).toBeGreaterThan(0)
  })

  for (const s of FIXTURE) {
    it(`${s.scenario}: agrees on every allocation`, () => {
      const domain = allocatePayment(buildScenario(s))
      const db = s.result

      // 1. Same number of allocation lines.
      expect(domain.lines.length, `${s.scenario}: line count`).toBe(db.allocations.length)

      // 2. Same days, same amounts, same full/part classification — in order.
      const domainLines = [...domain.lines]
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.groupName.localeCompare(b.groupName))
        .map(l => ({ due: l.dueDate, amount: l.amount.toDecimalString(), kind: l.kind }))
      const dbLines = [...db.allocations]
        .sort((a, b) => a.due_date.localeCompare(b.due_date) || a.group.localeCompare(b.group))
        .map(l => ({ due: l.due_date, amount: Money.fromDecimalString(l.amount).toDecimalString(), kind: l.kind }))

      expect(domainLines, `${s.scenario}: allocations`).toEqual(dbLines)

      // 3. Same total moved.
      const domainTotal = Money.sum(domain.lines.map(l => l.amount))
      expect(domainTotal.toDecimalString(), `${s.scenario}: total allocated`)
        .toBe(Money.fromDecimalString(db.total_allocated).toDecimalString())

      // 4. Same count of fully-settled obligations.
      expect(domain.obligationsSettled, `${s.scenario}: days settled`).toBe(db.days_settled)

      // 5. Same credit left on the originating membership.
      const domainCredit = domain.creditAfter.get(ORIGIN) ?? Money.zero()
      expect(domainCredit.toDecimalString(), `${s.scenario}: credit after`)
        .toBe(Money.fromDecimalString(db.credit_after).toDecimalString())

      // 6. Same isolation behaviour — did money leave the origin membership?
      const domainOther = new Set(
        domain.lines.filter(l => l.membershipId !== ORIGIN).map(l => l.membershipId),
      ).size
      expect(domainOther, `${s.scenario}: other memberships touched`)
        .toBe(db.other_memberships_touched)
    })
  }

  it('the ₵450 worked example is identical in both implementations', () => {
    const s = FIXTURE.find(x => x.scenario === 'worked_450')!
    const domain = allocatePayment(buildScenario(s))
    expect(domain.lines.map(l => l.amount.toDecimalString()))
      .toEqual(['100.00', '100.00', '100.00', '100.00', '50.00'])
    expect(s.result.allocations.map(a => Money.fromDecimalString(a.amount).toDecimalString()))
      .toEqual(['100.00', '100.00', '100.00', '100.00', '50.00'])
  })

  it('a payment scoped to one membership never reaches another, in either implementation', () => {
    const s = FIXTURE.find(x => x.scenario === 'isolation_slot_scope')!
    expect(s.extra_ms, 'scenario must include other memberships to be meaningful').toBeGreaterThan(0)
    expect(s.result.other_memberships_touched, 'database: money escaped the slot').toBe(0)
    const domain = allocatePayment(buildScenario(s))
    expect(domain.membershipsTouched, 'domain: money escaped the slot').toEqual([ORIGIN])
  })
})
