import { describe, it, expect } from 'vitest'
import { Money } from '../shared/money'
import { settleRegistrationFee, registrationState } from './settlement'

const ghs = (s: string) => Money.fromDecimalString(s)
const fee = (expected: string, recorded = expected) =>
  ({ expected: ghs(expected), recorded: ghs(recorded) })

describe('registration fee — a short payment settles nothing', () => {
  // The defect this replaces: `least(confirmed, recorded)` marked the
  // application PAID with whatever that produced, so two thirds of the money
  // bought a full registration.
  it('refuses GHS 100 against a GHS 150 fee', () => {
    const out = settleRegistrationFee(fee('150.00'), { confirmed: ghs('100.00') }, false)
    expect(out.kind).toBe('short')
    if (out.kind === 'short') {
      expect(out.received.toDecimalString()).toBe('100.00')
      expect(out.expected.toDecimalString()).toBe('150.00')
    }
  })

  it('refuses a shortfall of a single pesewa', () => {
    expect(settleRegistrationFee(fee('150.00'), { confirmed: ghs('149.99') }, false).kind).toBe('short')
  })

  it('accepts the exact fee', () => {
    expect(settleRegistrationFee(fee('150.00'), { confirmed: ghs('150.00') }, false).kind).toBe('settled')
  })

  it('never reports a partial amount as settled', () => {
    // Whatever the shortfall, there is no outcome that both settles and
    // applies less than the fee. "Partially registered" does not exist.
    for (const c of ['0.01', '1.00', '74.99', '149.99']) {
      const out = settleRegistrationFee(fee('150.00'), { confirmed: ghs(c) }, false)
      expect(out.kind, `GHS ${c}`).toBe('short')
    }
  })
})

describe('registration fee — an overpayment is not income', () => {
  it('records only the fee when the provider grossed it up by the service charge', () => {
    // The provider charges 150 + 1.5% = 152.25 and confirms that figure. The
    // susu's registration income is 150; the rest is the processor's.
    const out = settleRegistrationFee(fee('150.00'), { confirmed: ghs('152.25') }, false)
    expect(out.kind).toBe('settled')
    if (out.kind === 'settled') expect(out.applied.toDecimalString()).toBe('150.00')
  })

  it('records only the fee when somebody pays far too much', () => {
    const out = settleRegistrationFee(fee('150.00'), { confirmed: ghs('500.00') }, false)
    if (out.kind === 'settled') expect(out.applied.toDecimalString()).toBe('150.00')
  })
})

describe('registration fee — idempotency', () => {
  it('a replay changes nothing and reports the original amount', () => {
    const out = settleRegistrationFee(fee('150.00'), { confirmed: ghs('152.25') }, true)
    expect(out.kind).toBe('replay')
    if (out.kind === 'replay') expect(out.applied.toDecimalString()).toBe('150.00')
  })

  it('a hundred replays are indistinguishable from one', () => {
    const outs = Array.from({ length: 100 }, () =>
      settleRegistrationFee(fee('150.00'), { confirmed: ghs('150.00') }, true))
    expect(new Set(outs.map(o => o.kind)).size).toBe(1)
    expect(outs.every(o => o.kind === 'replay')).toBe(true)
  })

  it('a replay of a short payment is still refused', () => {
    // A short payment never settled, so it was never marked done — a repeat
    // callback must reach the same refusal rather than slipping through.
    expect(settleRegistrationFee(fee('150.00'), { confirmed: ghs('100.00') }, false).kind).toBe('short')
  })
})

describe('registration state — approved does not mean paid', () => {
  const base = { feeDue: ghs('150.00'), feePaid: false, hasPendingAttempt: false }

  it('applied, nothing paid', () => {
    expect(registrationState({ ...base, status: 'pending' })).toBe('awaiting_payment')
  })

  it('a raised prompt is not payment', () => {
    expect(registrationState({ ...base, status: 'pending', hasPendingAttempt: true }))
      .toBe('awaiting_confirmation')
  })

  it('paid, waiting for a human', () => {
    expect(registrationState({ ...base, status: 'pending', feePaid: true })).toBe('under_review')
  })

  it('no fee due needs no payment', () => {
    expect(registrationState({ ...base, status: 'pending', feeDue: Money.zero() })).toBe('under_review')
  })

  it('approved WITHOUT payment is still approved — the override must stay visible', () => {
    // The system permits an audited override. A state model that made
    // `approved` imply `paid` would hide exactly the case worth seeing.
    expect(registrationState({ ...base, status: 'approved', feePaid: false })).toBe('approved')
  })

  it('rejected outranks everything', () => {
    expect(registrationState({ ...base, status: 'rejected', feePaid: true })).toBe('rejected')
  })
})
