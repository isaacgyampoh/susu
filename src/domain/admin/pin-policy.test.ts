import { describe, it, expect } from 'vitest'
import { isTrivialPin, isWellFormedPin, rejectNewPin, SHIPPED_PIN } from './pin-policy'

/**
 * The database refuses these and only these as "too easy to guess". Copied
 * verbatim from the two IN (...) lists in `change_admin_password()`, migration
 * v43. If that function's lists change, this array must change with it — and
 * the equivalence test below is what forces the issue.
 */
const DB_REFUSES = [
  '0000','1111','2222','3333','4444','5555','6666','7777','8888','9999',
  '0123','1234','2345','3456','4567','5678','6789',
  '9876','8765','7654','6543','5432','4321','3210',
]

describe('administrator PIN policy', () => {
  it('accepts only four digits as a well-formed PIN', () => {
    expect(isWellFormedPin('1024')).toBe(true)
    expect(isWellFormedPin('102')).toBe(false)
    expect(isWellFormedPin('10245')).toBe(false)
    expect(isWellFormedPin('10a4')).toBe(false)
    expect(isWellFormedPin('')).toBe(false)
    expect(isWellFormedPin(' 1024')).toBe(false)
  })

  it('rejects repeated digits and consecutive runs', () => {
    for (const p of ['0000', '7777', '1234', '6789', '9876', '3210']) {
      expect(isTrivialPin(p), p).toBe(true)
    }
  })

  it('accepts an ordinary PIN', () => {
    for (const p of ['1024', '8391', '4708', '2580']) {
      expect(isTrivialPin(p), p).toBe(false)
    }
  })

  // The reason this file exists: the console's copy of the rule must reject
  // exactly what the database rejects, across the entire PIN space. A console
  // looser than the server promises a PIN and then fails it; a console stricter
  // than the server refuses one the system would have taken.
  it('agrees with the database across all 10,000 PINs', () => {
    const mine: string[] = []
    for (let n = 0; n < 10_000; n++) {
      const pin = String(n).padStart(4, '0')
      if (isTrivialPin(pin)) mine.push(pin)
    }
    expect(mine.sort()).toEqual([...DB_REFUSES].sort())
  })

  it('refuses the shipped PIN as a new choice, and says why', () => {
    expect(rejectNewPin(SHIPPED_PIN, '8391')).toMatch(/shipped with/)
  })

  it('refuses reusing the current PIN', () => {
    expect(rejectNewPin('8391', '8391')).toMatch(/have not used/)
  })

  it('passes an acceptable new PIN', () => {
    expect(rejectNewPin('4708', '1024')).toBeNull()
  })
})
