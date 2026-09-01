import { Money } from '../shared/money'
import type { RegistrationFee, ProviderConfirmation, SettlementOutcome, RegistrationState } from './types'

/**
 * The registration settlement rule, as a pure function.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * This is the same rule `settle_registration_fee()` implements in PostgreSQL,
 * and conformance.test.ts asserts the two agree. The duplication is deliberate
 * and matches the contribution engine: the SQL one is authoritative because
 * only the database can lock the row it is about to change; this one is what
 * the rest of the system can reason about, test exhaustively, and run without
 * a database.
 *
 * THREE RULES, AND THE SECOND IS THE ONE THAT MATTERS
 *
 *   1. A REPLAY CHANGES NOTHING. Ten callbacks for one payment settle once.
 *
 *   2. A SHORT PAYMENT SETTLES NOTHING. The previous implementation computed
 *      `least(confirmed, recorded)` and then marked the application paid with
 *      whatever that produced — so a provider reporting GHS 100 against a
 *      GHS 150 fee unlocked registration in full for two thirds of the money.
 *      There is no partial registration, so a shortfall is reported, logged,
 *      and left for a human.
 *
 *   3. AN OVERPAYMENT IS NOT INCOME. The provider charges the fee grossed up
 *      by the service charge, so `confirmed` is routinely LARGER than the fee.
 *      Only the fee is recorded; the difference is the payment processor's,
 *      not the susu's.
 */
export function settleRegistrationFee(
  fee: RegistrationFee,
  provider: ProviderConfirmation,
  alreadySettled: boolean,
): SettlementOutcome {
  if (alreadySettled) return { kind: 'replay', applied: fee.recorded }

  // Strictly less. There is no tolerance band here, and there should not be:
  // the SQL engine compares with a half-pesewa epsilon, which on integer minor
  // units is exactly this comparison. A wider tolerance in one implementation
  // than the other is how the two drift apart — the conformance suite caught
  // precisely that when this line briefly forgave one pesewa.
  if (provider.confirmed.isLessThan(fee.expected)) {
    return { kind: 'short', received: provider.confirmed, expected: fee.expected }
  }

  return { kind: 'settled', applied: Money.min(provider.confirmed, fee.recorded) }
}

/**
 * What an applicant is shown, derived from facts rather than stored.
 *
 * `approved` deliberately does NOT imply the fee was received: the system
 * allows an audited override, and a state model that conflated the two would
 * make that override invisible.
 */
export function registrationState(facts: {
  status: 'pending' | 'approved' | 'rejected'
  feeDue: Money
  feePaid: boolean
  hasPendingAttempt: boolean
}): RegistrationState {
  if (facts.status === 'rejected') return 'rejected'
  if (facts.status === 'approved') return 'approved'
  if (facts.feePaid || facts.feeDue.isZero) return 'under_review'
  return facts.hasPendingAttempt ? 'awaiting_confirmation' : 'awaiting_payment'
}
