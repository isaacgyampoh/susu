import { describe, it, expect } from 'vitest'
import { Money, MoneyError, ghs, pesewas } from './money'

describe('Money — construction', () => {
  it('holds whole cedis as pesewas', () => {
    expect(ghs(100).minor).toBe(10000)
    expect(ghs(55).minor).toBe(5500)
    expect(Money.zero().minor).toBe(0)
  })

  it('parses decimal strings exactly, without going through a float', () => {
    // The case that motivated this class. Number('10.90') * 100 is
    // 1089.9999999999998, which rounds to the right answer by luck and would
    // not always. This path never produces a fractional intermediate.
    expect(Money.fromDecimalString('10.90').minor).toBe(1090)
    expect(Money.fromDecimalString('0.01').minor).toBe(1)
    expect(Money.fromDecimalString('0.1').minor).toBe(10)
    expect(Money.fromDecimalString('1234567.89').minor).toBe(123456789)
    expect(Money.fromDecimalString('-42.50').minor).toBe(-4250)
  })

  it('rounds a third decimal place half-up, as the database would', () => {
    expect(Money.fromDecimalString('10.905').minor).toBe(1091)
    expect(Money.fromDecimalString('10.904').minor).toBe(1090)
  })

  it('reads what the database driver returns, string or number', () => {
    expect(Money.fromDatabase('55.00').minor).toBe(5500)
    expect(Money.fromDatabase(55).minor).toBe(5500)
    expect(Money.fromDatabase(10.9).minor).toBe(1090)
    expect(Money.fromDatabase(null).minor).toBe(0)
    expect(Money.fromDatabase(undefined).minor).toBe(0)
  })

  it('refuses values that are not money', () => {
    expect(() => Money.fromMinor(10.5)).toThrow(MoneyError)
    expect(() => Money.fromMinor(NaN)).toThrow(MoneyError)
    expect(() => Money.fromMinor(Infinity)).toThrow(MoneyError)
    expect(() => Money.fromDecimalString('abc')).toThrow(MoneyError)
    expect(() => Money.fromDecimalString('')).toThrow(MoneyError)
    expect(() => Money.fromDecimalString('1.2.3')).toThrow(MoneyError)
    expect(() => Money.fromDatabase({} as unknown)).toThrow(MoneyError)
  })

  it('refuses amounts wider than DECIMAL(10,2)', () => {
    expect(() => Money.fromMinor(100_000_000_00)).toThrow(MoneyError)
  })
})

describe('Money — arithmetic', () => {
  it('adds and subtracts without drift', () => {
    expect(ghs(100).plus(ghs(50)).minor).toBe(15000)
    expect(ghs(100).minus(ghs(40)).minor).toBe(6000)
    expect(ghs(100).minus(ghs(150)).minor).toBe(-5000)
  })

  it('survives an accumulation that floats would not', () => {
    // 0.10 + 0.20 !== 0.30 in binary floating point. Here it is exact, and
    // stays exact across a whole cycle of daily contributions.
    let total = Money.zero()
    for (let i = 0; i < 3; i++) total = total.plus(Money.fromDecimalString('0.10'))
    expect(total.toDecimalString()).toBe('0.30')

    let year = Money.zero()
    for (let i = 0; i < 365; i++) year = year.plus(Money.fromDecimalString('10.90'))
    expect(year.toDecimalString()).toBe('3978.50')
  })

  it('scales by slot fractions the way the schedule generator does', () => {
    // ROUND(contribution * slot_fraction, 2) in SQL must agree with this.
    expect(ghs(100).times(0.25).toDecimalString()).toBe('25.00')
    expect(ghs(100).times(0.5).toDecimalString()).toBe('50.00')
    expect(ghs(55).times(0.25).toDecimalString()).toBe('13.75')
    // A fraction that does not divide evenly into pesewas.
    expect(Money.fromDecimalString('0.10').times(0.25).toDecimalString()).toBe('0.03')
  })

  it('rounds half-up away from zero, matching PostgreSQL', () => {
    expect(pesewas(5).times(0.5, 'half-up').minor).toBe(3)   // 2.5 → 3
    expect(pesewas(-5).times(0.5, 'half-up').minor).toBe(-3) // -2.5 → -3, not -2
    expect(pesewas(5).times(0.5, 'down').minor).toBe(2)
    expect(pesewas(5).times(0.5, 'up').minor).toBe(3)
  })

  it('clamps to zero where a negative balance would be meaningless', () => {
    expect(ghs(40).minus(ghs(100)).clampToZero().isZero).toBe(true)
    expect(ghs(100).minus(ghs(40)).clampToZero().minor).toBe(6000)
  })

  it('refuses to mix currencies', () => {
    const usd = Money.fromMinor(100, 'USD')
    expect(() => ghs(1).plus(usd)).toThrow(MoneyError)
    expect(() => ghs(1).compare(usd)).toThrow(MoneyError)
  })
})

describe('Money — comparison', () => {
  it('orders and compares', () => {
    expect(ghs(100).isGreaterThan(ghs(50))).toBe(true)
    expect(ghs(50).isLessThan(ghs(100))).toBe(true)
    expect(ghs(100).isGreaterOrEqual(ghs(100))).toBe(true)
    expect(ghs(100).equals(ghs(100))).toBe(true)
    expect(Money.min(ghs(10), ghs(20)).minor).toBe(1000)
    expect(Money.max(ghs(10), ghs(20)).minor).toBe(2000)
  })

  it('knows zero, positive and negative', () => {
    expect(Money.zero().isZero).toBe(true)
    expect(ghs(1).isPositive).toBe(true)
    expect(ghs(-1).isNegative).toBe(true)
    expect(Money.zero().isPositive).toBe(false)
  })

  it('sums a list, including the empty one', () => {
    expect(Money.sum([ghs(10), ghs(20), ghs(30)]).minor).toBe(6000)
    expect(Money.sum([]).minor).toBe(0)
  })
})

describe('Money — output', () => {
  it('produces a value the DECIMAL column accepts', () => {
    expect(ghs(100).toDecimalString()).toBe('100.00')
    expect(pesewas(5).toDecimalString()).toBe('0.05')
    expect(pesewas(-5).toDecimalString()).toBe('-0.05')
    expect(Money.zero().toDecimalString()).toBe('0.00')
  })

  it('formats for display with grouping', () => {
    expect(Money.fromMajor(16430).format()).toBe('GHS 16,430.00')
    expect(Money.fromMajor(16430).format({ currency: false })).toBe('16,430.00')
    expect(ghs(100).format({ grouping: false })).toBe('GHS 100.00')
    expect(ghs(-50).format()).toBe('GHS -50.00')
  })

  it('round-trips through its decimal form', () => {
    for (const v of ['0.00', '0.01', '10.90', '16430.00', '99999.99', '-42.50']) {
      expect(Money.fromDecimalString(v).toDecimalString()).toBe(v)
    }
  })
})
