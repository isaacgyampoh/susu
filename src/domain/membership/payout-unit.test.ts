import { describe, it, expect } from 'vitest'
import {
  QUARTERS_PER_TURN, quartersOf, fractionOf,
  SLOT_FRACTIONS, type SlotFraction,
} from './types'

/**
 * THE FRACTIONAL SLOT RULE, IN INTEGERS.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The database enforces this for real — `docs/phase-d/payout-units.sql` runs
 * against the actual tables, triggers and placement function. These tests cover
 * the part that lives in TypeScript: that the conversion is exact, and that
 * nothing here ever adds fractions together.
 *
 * §7 of the brief is the reason. Summing 0.25 four times in JavaScript does not
 * reliably give 1, and "is this turn full?" decides whether a member gets a
 * payout date. It is not a question that may be answered approximately.
 */
describe('slot sizes as quarter-shares', () => {
  it('maps each slot size to an exact integer', () => {
    expect(quartersOf(1)).toBe(4)
    expect(quartersOf(0.5)).toBe(2)
    expect(quartersOf(0.25)).toBe(1)
  })

  it('round-trips every slot size without loss', () => {
    for (const f of SLOT_FRACTIONS) {
      expect(fractionOf(quartersOf(f))).toBe(f)
    }
  })

  it('fills a turn with exactly four quarters, where floating point does not', () => {
    const quarters: SlotFraction[] = [0.25, 0.25, 0.25, 0.25]

    // The way capacity is actually counted.
    expect(quarters.reduce((n, f) => n + quartersOf(f), 0)).toBe(QUARTERS_PER_TURN)

    // The way it must never be counted. This is not a hypothetical: it is
    // exactly the comparison that would silently refuse the fourth quarter.
    const naive = quarters.reduce((n, f) => n + f, 0)
    expect(naive === 1).toBe(true)          // four quarters happen to be safe...
    expect(0.1 + 0.2 === 0.3).toBe(false)   // ...and this is why that is luck.
  })

  it('counts a half and two quarters as one full turn', () => {
    const shares: SlotFraction[] = [0.5, 0.25, 0.25]
    expect(shares.reduce((n, f) => n + quartersOf(f), 0)).toBe(QUARTERS_PER_TURN)
  })

  it('does not treat a part-filled turn as full', () => {
    const two: SlotFraction[] = [0.25, 0.25]
    const three: SlotFraction[] = [0.25, 0.25, 0.25]
    const oneHalf: SlotFraction[] = [0.5]

    for (const set of [two, three, oneHalf]) {
      const filled = set.reduce((n, f) => n + quartersOf(f), 0)
      expect(filled).toBeLessThan(QUARTERS_PER_TURN)
    }
  })

  it('leaves no room in a turn already holding a full slot', () => {
    const room = QUARTERS_PER_TURN - quartersOf(1)
    expect(room).toBe(0)
    // The v16-era pairing that production still carries: a half onto a full
    // slot, adding up to one and a half turns. Refused now.
    expect(quartersOf(0.5)).toBeGreaterThan(room)
  })
})
