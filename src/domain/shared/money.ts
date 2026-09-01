/**
 * Money.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Every amount in this system is an integer number of PESEWAS. GHS 100.00 is
 * 10000. GHS 0.50 is 50. There is no floating-point arithmetic anywhere in
 * this file, and none should exist anywhere downstream of it.
 *
 * Why this matters here specifically. The settlement engine this replaces
 * carried amounts as JavaScript numbers and reconciled them with
 * `Math.round(x * 100) / 100` after each subtraction. That is not a rounding
 * strategy, it is a hope: the intermediate value has already lost precision by
 * the time you round it, and the correction is applied inconsistently — one
 * path rounds after every step, another never rounds its subtotal, a third
 * rounds the fee and then rounds the sum again. Over a member's 330-day cycle
 * those disagreements accumulate into a balance nobody can reconcile.
 *
 * The database is already correct: DECIMAL(10,2) throughout. The defect was
 * only ever in the layer above it, so this type is the fix for the whole class.
 *
 * PARSING IS THE DANGEROUS PART. A value arriving from PostgREST as the string
 * "10.90" must never be turned into money via `Number("10.90") * 100`, which
 * yields 1089.9999999999998. `fromDecimalString` works on the digits.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** How to resolve a fraction of a pesewa. */
export type Rounding =
  /** Away from zero at the midpoint. Matches PostgreSQL's ROUND() on numeric. */
  | 'half-up'
  /** Toward zero. Used where the payer must never be charged the extra pesewa. */
  | 'down'
  /** Away from zero. Used where the member must never be short-changed. */
  | 'up'

export class MoneyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MoneyError'
  }
}

/** DECIMAL(10,2) — the widest value the database column can hold, in pesewas. */
const MAX_MINOR = 99_999_999_99

export class Money {
  /** Pesewas. Always a safe integer. */
  readonly minor: number
  readonly currency: string

  private constructor(minor: number, currency: string) {
    this.minor = minor
    this.currency = currency
  }

  // ── Construction ────────────────────────────────────────────────────────

  static fromMinor(minor: number, currency = 'GHS'): Money {
    if (typeof minor !== 'number' || !Number.isFinite(minor)) {
      throw new MoneyError(`Not a finite amount: ${String(minor)}`)
    }
    if (!Number.isInteger(minor)) {
      throw new MoneyError(`Minor units must be a whole number of pesewas, got ${minor}`)
    }
    if (Math.abs(minor) > MAX_MINOR) {
      throw new MoneyError(`Amount ${minor} exceeds what DECIMAL(10,2) can hold`)
    }
    return new Money(minor, currency)
  }

  /** From whole cedis. `Money.fromMajor(55)` → GHS 55.00. */
  static fromMajor(major: number, currency = 'GHS'): Money {
    if (!Number.isFinite(major)) throw new MoneyError(`Not a finite amount: ${String(major)}`)
    return Money.fromMinor(Math.round(major * 100), currency)
  }

  /**
   * From a decimal string — the safe path for anything that came out of the
   * database or off the wire. Digits are read directly; the value never
   * becomes a float.
   */
  static fromDecimalString(value: string, currency = 'GHS'): Money {
    const raw = String(value).trim()
    const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(raw)
    if (!m) throw new MoneyError(`Not a decimal amount: "${value}"`)

    const [, sign, whole, frac = ''] = m
    // Pad or truncate to exactly two decimal places, rounding half-up on the
    // third digit so "10.905" behaves the way the database would.
    let pesewas: number
    if (frac.length <= 2) {
      pesewas = Number(frac.padEnd(2, '0'))
    } else {
      const keep = Number(frac.slice(0, 2))
      const next = Number(frac[2])
      pesewas = next >= 5 ? keep + 1 : keep
    }
    let minor = Number(whole) * 100 + pesewas
    if (!Number.isSafeInteger(minor)) throw new MoneyError(`Amount out of range: "${value}"`)
    if (sign === '-') minor = -minor
    return Money.fromMinor(minor, currency)
  }

  /**
   * From whatever the database driver produced. PostgREST returns DECIMAL as a
   * string; some clients coerce it to a number. Both are handled, and only the
   * string path is exact — which is why repositories should preserve strings.
   */
  static fromDatabase(value: unknown, currency = 'GHS'): Money {
    if (value === null || value === undefined) return Money.zero(currency)
    if (value instanceof Money) return value
    if (typeof value === 'string') return Money.fromDecimalString(value, currency)
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new MoneyError(`Not a finite amount: ${value}`)
      // Fixed notation avoids "1e-7" reaching the parser.
      return Money.fromDecimalString(value.toFixed(2), currency)
    }
    throw new MoneyError(`Cannot read money from ${typeof value}`)
  }

  static zero(currency = 'GHS'): Money {
    return new Money(0, currency)
  }

  // ── Arithmetic ──────────────────────────────────────────────────────────

  private assertSame(other: Money): void {
    if (other.currency !== this.currency) {
      throw new MoneyError(`Cannot mix ${this.currency} and ${other.currency}`)
    }
  }

  plus(other: Money): Money {
    this.assertSame(other)
    return Money.fromMinor(this.minor + other.minor, this.currency)
  }

  minus(other: Money): Money {
    this.assertSame(other)
    return Money.fromMinor(this.minor - other.minor, this.currency)
  }

  /**
   * Scale by a ratio — slot fractions (¼, ½), percentages, service charges.
   *
   * The rounding mode is REQUIRED to be thought about, so it is an explicit
   * argument with a default that matches the database. `ROUND(x * 0.25, 2)` in
   * PostgreSQL and `.times(0.25)` here must agree, or a quarter-slot's daily
   * contribution differs by a pesewa between the schedule generator and the
   * portal.
   */
  times(factor: number, rounding: Rounding = 'half-up'): Money {
    if (!Number.isFinite(factor)) throw new MoneyError(`Not a finite factor: ${String(factor)}`)
    const exact = this.minor * factor
    return Money.fromMinor(applyRounding(exact, rounding), this.currency)
  }

  negated(): Money {
    return Money.fromMinor(-this.minor, this.currency)
  }

  absolute(): Money {
    return Money.fromMinor(Math.abs(this.minor), this.currency)
  }

  /** Never below zero. The shape most allocation arithmetic actually wants. */
  clampToZero(): Money {
    return this.minor < 0 ? Money.zero(this.currency) : this
  }

  // ── Comparison ──────────────────────────────────────────────────────────

  compare(other: Money): -1 | 0 | 1 {
    this.assertSame(other)
    return this.minor < other.minor ? -1 : this.minor > other.minor ? 1 : 0
  }

  equals(other: Money): boolean          { return this.currency === other.currency && this.minor === other.minor }
  isGreaterThan(other: Money): boolean   { return this.compare(other) === 1 }
  isGreaterOrEqual(other: Money): boolean{ return this.compare(other) >= 0 }
  isLessThan(other: Money): boolean      { return this.compare(other) === -1 }
  isLessOrEqual(other: Money): boolean   { return this.compare(other) <= 0 }

  get isZero(): boolean     { return this.minor === 0 }
  get isPositive(): boolean { return this.minor > 0 }
  get isNegative(): boolean { return this.minor < 0 }

  static min(a: Money, b: Money): Money { return a.isLessOrEqual(b) ? a : b }
  static max(a: Money, b: Money): Money { return a.isGreaterOrEqual(b) ? a : b }

  static sum(amounts: readonly Money[], currency = 'GHS'): Money {
    return amounts.reduce((acc, m) => acc.plus(m), Money.zero(currency))
  }

  // ── Output ──────────────────────────────────────────────────────────────

  /** "100.00" — the form to send back to a DECIMAL(10,2) column. */
  toDecimalString(): string {
    const neg = this.minor < 0
    const abs = Math.abs(this.minor)
    return `${neg ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
  }

  /** "GHS 1,250.00" — for display only. Never feed this back into arithmetic. */
  format(opts: { currency?: boolean; grouping?: boolean } = {}): string {
    const { currency = true, grouping = true } = opts
    const neg = this.minor < 0
    const abs = Math.abs(this.minor)
    const whole = String(Math.floor(abs / 100))
    const grouped = grouping ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : whole
    // The sign sits with the number, not before the currency label, so amounts
    // stay aligned when they are read down a column.
    const body = `${neg ? '-' : ''}${grouped}.${String(abs % 100).padStart(2, '0')}`
    return currency ? `${this.currency} ${body}` : body
  }

  /**
   * A plain number of cedis. DISPLAY AND SERIALISATION ONLY — the moment this
   * value enters arithmetic the guarantees of this class are gone.
   */
  toMajorNumber(): number {
    return this.minor / 100
  }

  toJSON(): { minor: number; currency: string; decimal: string } {
    return { minor: this.minor, currency: this.currency, decimal: this.toDecimalString() }
  }

  toString(): string {
    return this.format()
  }
}

function applyRounding(exact: number, mode: Rounding): number {
  if (Number.isInteger(exact)) return exact
  switch (mode) {
    case 'down': return Math.trunc(exact)
    case 'up':   return exact < 0 ? Math.floor(exact) : Math.ceil(exact)
    case 'half-up': {
      // Away from zero at the midpoint, matching PostgreSQL's numeric ROUND.
      // Math.round(-0.5) is -0 in JavaScript, which is the wrong direction.
      return exact < 0 ? -Math.round(-exact) : Math.round(exact)
    }
  }
}

/** Convenience for tests and fixtures: `ghs(100)` → GHS 100.00. */
export const ghs = (major: number) => Money.fromMajor(major)
/** Convenience for exact pesewa amounts: `pesewas(50)` → GHS 0.50. */
export const pesewas = (minor: number) => Money.fromMinor(minor)
