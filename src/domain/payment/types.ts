import type { Money } from '../shared/money'
import type { GroupId, MemberId, MembershipId } from '../membership/types'
import type { ObligationId } from '../contribution/types'

/**
 * The payment model.
 *
 * ────────────────────────────────────────────────────────────────────────────
 *     Payment ──< PaymentAllocation >── Obligation
 *
 * A payment is ONE event with ONE provider reference. It may cover many days
 * across many memberships, so it has MANY allocations. That asymmetry is the
 * heart of finding F-02: the existing schema carries the provider reference on
 * the CONTRIBUTION row, and a unique index on it, while three settlement paths
 * write the same reference across every day the payment covered. A reference
 * is the identity of a payment, never of an obligation.
 *
 * So here: idempotency lives on Payment. Allocations are separate records and
 * are unique on (paymentId, obligationId), which is the correct grain — one
 * payment may touch a given day only once, but may touch many days.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type PaymentId = string & { readonly __brand: 'PaymentId' }
export const asPaymentId = (v: string) => v as PaymentId

/** How the money reached us. */
export type PaymentChannel =
  | 'mobile-money'  // a provider prompt the member approved
  | 'cash'          // collected by hand
  | 'bank'          // transfer
  | 'credit'        // applied from a membership's existing advance

export type PaymentStatus =
  | 'pending'    // intent recorded, provider asked, nothing settled
  | 'succeeded'  // confirmed by the provider and allocated
  | 'failed'
  | 'reversed'   // was succeeded, then undone by an operator

/** What the payment is FOR. Registration fees are not contributions. */
export type PaymentPurpose = 'contribution' | 'registration-fee'

export interface Payment {
  readonly id: PaymentId
  readonly memberId: MemberId
  /** The membership the member chose to pay into, if any. */
  readonly membershipId: MembershipId | null
  readonly purpose: PaymentPurpose
  readonly channel: PaymentChannel
  /**
   * What the member is contributing — NOT what their wallet was debited.
   * The service charge is the operator's fee and is never savings, so it is
   * tracked separately and never allocated to an obligation.
   */
  readonly amount: Money
  readonly serviceCharge: Money
  /** amount + serviceCharge — what the provider actually collects. */
  readonly amountCharged: Money
  readonly status: PaymentStatus
  /** OUR identity for the payment. Unique. The idempotency key. */
  readonly reference: string
  /** The provider's identity for it, when we have one. Unique when present. */
  readonly providerReference: string | null
  readonly createdAt: string
  readonly settledAt: string | null
}

/**
 * One obligation, one payment, one amount. The audit record that answers
 * "what did this GHS 450 actually pay for?" — the question the current system
 * cannot answer for four of its five settlement paths.
 */
export interface PaymentAllocation {
  readonly paymentId: PaymentId
  readonly reference: string
  readonly obligationId: ObligationId
  /** Denormalised for reporting; identity is still the ids above. */
  readonly membershipId: MembershipId
  readonly groupId: GroupId
  readonly groupName: string
  readonly dueDate: string
  readonly amount: Money
  readonly kind: 'full' | 'part'
  readonly createdAt: string
}

/**
 * Unapplied money held against a MEMBERSHIP.
 *
 * Deliberately not a balance on the member. `members.credit_balance` as it
 * exists today lets a surplus paid into Group A settle Group B's next
 * obligation, which the specification forbids: memberships must never pool
 * money. The target design is this record, per membership.
 *
 * NOT YET MIGRATED. How existing production balances map onto it needs the
 * Phase 01 financial output, so the type is defined and tested while the data
 * migration waits.
 */
export interface MembershipCredit {
  readonly membershipId: MembershipId
  readonly memberId: MemberId
  readonly balance: Money
  readonly updatedAt: string
}

/** A reversal, recorded rather than deleted. */
export interface PaymentReversal {
  readonly paymentId: PaymentId
  readonly reversedBy: string
  readonly reason: string | null
  readonly reversedAt: string
  /** Which allocations were undone. A payment may be partly reversed. */
  readonly allocationsReversed: readonly ObligationId[]
}
