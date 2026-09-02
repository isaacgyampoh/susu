import type { Money } from '../shared/money'

/**
 * REGISTRATION is not CONTRIBUTION.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A registration fee buys a place in a group. It discharges no daily
 * obligation, it is never allocated to one, and it never becomes credit.
 * The two live in separate folders for exactly that reason: the moment a
 * registration fee can reach `allocatePayment`, a member's fee starts paying
 * their contributions.
 *
 * The type system carries the distinction. There is no shared "Payment" union
 * that both flow through, because a union is an invitation to write one
 * handler for both.
 */

/** Where an application stands. Derived, never stored as a single column. */
export type RegistrationState =
  | 'awaiting_payment'       // applied; fee not received
  | 'awaiting_confirmation'  // a prompt was raised; the provider has not answered
  | 'payment_received'       // the provider confirmed the full fee
  | 'under_review'           // paid (or no fee), waiting for a human
  | 'approved'
  | 'rejected'

export interface RegistrationFee {
  /** The authoritative fee, computed by the server from group configuration. */
  readonly expected: Money
  /** What we recorded when the prompt was raised. Never larger than expected. */
  readonly recorded: Money
}

/** What the provider told us. A client's claim is not one of these. */
export interface ProviderConfirmation {
  readonly confirmed: Money
}

export type SettlementOutcome =
  /** Full fee received. The application may now be reviewed. */
  | { kind: 'settled'; applied: Money }
  /** Already settled by an earlier call. Nothing changed. */
  | { kind: 'replay'; applied: Money }
  /**
   * The provider confirmed LESS than the fee. Nothing settles: there is no
   * such thing as a partially registered member, and inventing one would be
   * guessing at money.
   */
  | { kind: 'short'; received: Money; expected: Money }
