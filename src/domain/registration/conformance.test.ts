import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Money } from '../shared/money'
import { settleRegistrationFee } from './settlement'

/**
 * CONFORMANCE — the pure registration rule against the deployed SQL function.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The fixture was captured by running each scenario through the REAL
 * `settle_registration_fee()` on the production database, inside a transaction
 * that was then rolled back. This test replays the same scenarios in memory
 * and asserts the two agree — on whether it settled, on whether it was short,
 * and on the amount, to the pesewa.
 *
 * It has already earned its place. The pure rule was first written to forgive
 * a one-pesewa shortfall; the database forgives none. The capture disagreed on
 * `149.99 against a 150.00 fee` and the pure rule was wrong.
 *
 * If these two disagree, one of them is wrong about whether somebody has paid
 * to join a susu. The fix is to correct an implementation — never to relax
 * this test.
 *
 * REGENERATING: docs/phase-07/capture-registration-conformance.sql
 * ────────────────────────────────────────────────────────────────────────────
 */

interface DbCase {
  scenario: string
  fee: string
  confirmed: string
  replay: boolean
  settled: boolean
  already: boolean
  short: boolean
  applied: string
  fee_paid_after: boolean
}

const FIXTURE: DbCase[] = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'db-registration-conformance.json'), 'utf8'),
)

describe('registration settlement — pure rule matches the database', () => {
  it('has scenarios captured from production', () => {
    expect(FIXTURE.length).toBeGreaterThanOrEqual(10)
  })

  for (const c of FIXTURE) {
    it(`${c.scenario}: GHS ${c.confirmed} against a GHS ${c.fee} fee`, () => {
      const fee = Money.fromDecimalString(c.fee)
      const out = settleRegistrationFee(
        { expected: fee, recorded: fee },
        { confirmed: Money.fromDecimalString(c.confirmed) },
        c.replay,
      )

      // The database reports three booleans; the pure rule reports one tag.
      // Asserting the mapping in both directions is what makes them equivalent
      // rather than merely similar.
      if (c.short) {
        expect(out.kind, 'the database refused this as short').toBe('short')
        expect(c.settled).toBe(false)
        expect(c.fee_paid_after, 'a short payment must never mark the fee paid').toBe(false)
      } else if (c.already) {
        expect(out.kind).toBe('replay')
        expect(c.fee_paid_after).toBe(true)
      } else {
        expect(out.kind).toBe('settled')
        expect(c.fee_paid_after).toBe(true)
        if (out.kind === 'settled') {
          // Only the fee is income. The service charge the provider added on
          // top is theirs, and an overpayment is not registration revenue.
          expect(out.applied.toDecimalString()).toBe(Money.fromDecimalString(c.applied).toDecimalString())
        }
      }
    })
  }
})
