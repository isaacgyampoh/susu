import type { Money } from '../../domain/shared/money'
import type { MemberId, MembershipId } from '../../domain/membership/types'
import type { CoverageState, MembershipPosition, Obligation } from '../../domain/contribution/types'
import type { AllocationPolicy } from '../../domain/contribution/policy'
import type { AllocationPreview } from '../../domain/contribution/allocation'
import type { PaymentId, PaymentAllocation, Payment } from '../../domain/payment/types'
import type { MobileMoneyNetwork } from '../ports/payment-provider'

/**
 * Application use cases — the boundary, declared.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * These are CONTRACTS, not implementations. Phase 02 is explicitly scoped to
 * establishing boundaries without touching production behaviour, so what lives
 * here is the shape each operation must take: what it needs, what it promises,
 * and where authorization happens.
 *
 * Three rules hold across every one of them, and they are the whole point:
 *
 *   1. AUTHORIZATION IS AN ARGUMENT, NOT AN AMBIENT FACT. Every use case takes
 *      an explicit `actor`. None of them reads a cookie, a header or a session
 *      — presentation resolves identity and passes it in, so authorization can
 *      be unit-tested and can never be accidentally skipped by a caller that
 *      forgot to check.
 *
 *   2. NO USE CASE RETURNS A ROW. They return domain values with `Money`, so a
 *      caller cannot receive a number and start doing arithmetic on it.
 *
 *   3. READS ARE ONE ROUND TRIP. `GetMemberDashboard` is specified to make a
 *      bounded number of queries regardless of how many groups a member is in.
 *      A member in twenty groups must not cost forty-six round trips, which is
 *      what the current `member-profile` does.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Who is asking. Resolved by presentation, verified server-side, never trusted from a body. */
export type Actor =
  | { readonly kind: 'member'; readonly memberId: MemberId }
  | { readonly kind: 'admin';  readonly adminId: string; readonly role: 'admin' | 'super_admin' }
  | { readonly kind: 'system'; readonly job: string }

export class AuthorizationError extends Error {
  constructor(message = 'Not permitted') {
    super(message)
    this.name = 'AuthorizationError'
  }
}

// ── Reads ──────────────────────────────────────────────────────────────────

/** One membership as the portal shows it. */
export interface MembershipSummary {
  readonly membershipId: MembershipId
  readonly groupName: string
  readonly slotLabel: string
  readonly position: MembershipPosition
  /** What the member owes for today on THIS membership, after part payment. */
  readonly dueToday: Money
  readonly coverage: CoverageState
  /** Obligations already settled ahead of their due date. */
  readonly coveredAhead: readonly { dueDate: string; amount: Money }[]
  readonly nextUnsettled: Obligation | null
  readonly payoutDate: string | null
  readonly payoutAmount: Money | null
}

/**
 * Everything the member portal renders, for EVERY membership.
 *
 * `totalDueToday` is the sum across memberships, computed once, server-side.
 * It exists so no screen ever sums a list in the browser — the mistake that
 * put a `reduce` over money into a React component.
 */
export interface MemberDashboard {
  readonly memberId: MemberId
  readonly memberName: string
  readonly memberCode: string
  readonly memberships: readonly MembershipSummary[]
  readonly totalDueToday: Money
  readonly totalPaidAllTime: Money
  readonly totalOutstanding: Money
  readonly asOf: string
}

export interface GetMemberDashboard {
  /** Members read only their own dashboard; admins may read any. */
  execute(actor: Actor, memberId: MemberId): Promise<MemberDashboard>
}

export interface GetMembershipDetails {
  execute(actor: Actor, membershipId: MembershipId): Promise<{
    readonly summary: MembershipSummary
    readonly obligations: readonly Obligation[]
    readonly payments: readonly { payment: Payment; allocations: readonly PaymentAllocation[] }[]
  }>
}

export interface GetContributionStatus {
  /** The coverage of one membership as at a given day. */
  execute(actor: Actor, membershipId: MembershipId, asOf: string): Promise<MembershipPosition>
}

export interface GetMemberStatement {
  execute(actor: Actor, memberId: MemberId, from: string, to: string): Promise<{
    readonly entries: readonly {
      date: string
      kind: 'contribution' | 'payout' | 'penalty' | 'credit'
      description: string
      debit: Money
      credit: Money
      membershipId: MembershipId | null
    }[]
    readonly openingBalance: Money
    readonly closingBalance: Money
  }>
}

// ── Payment ────────────────────────────────────────────────────────────────

export interface CreatePaymentInput {
  readonly membershipId: MembershipId
  /**
   * What the member chooses to pay. The SERVER re-derives what is owed and
   * what the charge will be — a client-supplied amount is a request, never an
   * authority.
   */
  readonly amount: Money
  readonly payerNumber: string
  readonly network: MobileMoneyNetwork
  /** The member's "pay this group only" choice. */
  readonly restrictToMembership: boolean
}

export interface PreviewPaymentAllocation {
  /**
   * What a payment WOULD cover, before the member approves anything.
   *
   * Runs the same pure allocator the settlement will run, so the screen that
   * says "this covers today, tomorrow, and GHS 50 of Wednesday" is not making
   * a separate guess. This is the §16 transparency requirement.
   */
  execute(actor: Actor, input: CreatePaymentInput): Promise<AllocationPreview>
}

export interface CreatePayment {
  /** Records intent and asks the provider to prompt. Settles nothing. */
  execute(actor: Actor, input: CreatePaymentInput): Promise<{
    readonly paymentId: PaymentId
    readonly reference: string
    readonly amountCharged: Money
    readonly serviceCharge: Money
    readonly status: 'prompted' | 'otp-required'
    readonly message: string
    readonly ussd?: string
  }>
}

export interface VerifyPayment {
  /**
   * Ask the provider, and settle if — and only if — it confirms.
   *
   * Idempotent by contract: calling it ten times for one payment settles once.
   */
  execute(actor: Actor, reference: string): Promise<{
    readonly status: 'settled' | 'pending' | 'failed'
    readonly message: string
    readonly allocations?: readonly PaymentAllocation[]
  }>
}

export interface ProcessPaymentWebhook {
  /**
   * Handle an unauthenticated provider callback.
   *
   * The payload may identify a payment and NOTHING more. Settlement is decided
   * by `VerifyPayment`, which asks the provider directly. A callback that
   * cannot be verified settles nothing — closing finding F-04, where trusting
   * the body when the status endpoint lagged allowed a forged callback to
   * settle a payment that never happened.
   */
  execute(payload: unknown): Promise<{ readonly acknowledged: true }>
}

export interface AllocatePayment {
  /**
   * Apply a confirmed payment to obligations, atomically.
   *
   * The ONE place money is applied. Runs in a single database transaction with
   * the obligation rows locked, and either every allocation and the credit
   * change land together, or none do.
   */
  execute(input: {
    readonly paymentId: PaymentId
    readonly confirmedAmount: Money
    readonly policy: AllocationPolicy
    readonly asOf: string
  }): Promise<{
    readonly allocations: readonly PaymentAllocation[]
    readonly creditAfter: ReadonlyMap<MembershipId, Money>
  }>
}

// ── Registration ───────────────────────────────────────────────────────────

export interface CreateRegistration {
  execute(input: {
    readonly fullName: string
    readonly phone: string
    readonly ghanaCardNumber: string
    readonly selections: readonly { groupId: string; slots: number; fraction: number }[]
  }): Promise<{ readonly registrationId: string; readonly feeDue: Money }>
}

export interface VerifyRegistrationPayment {
  execute(registrationId: string): Promise<{ readonly paid: boolean; readonly amount: Money }>
}

export interface ActivateMembership {
  /**
   * Turn an approved registration into live memberships.
   *
   * Gated on verified registration payment where the group requires it — the
   * §15 rule the current `kyc-review` does not enforce, since it creates an
   * active member without ever reading `registration_fee_paid`.
   */
  execute(actor: Actor, registrationId: string): Promise<{
    readonly memberId: MemberId
    readonly membershipIds: readonly MembershipId[]
  }>
}

// ── Payout ─────────────────────────────────────────────────────────────────

export interface CalculatePayout {
  /**
   * What a membership collects, and whether it may collect yet.
   *
   * The amount is whatever the operator decided. It is NEVER derived from a
   * formula — finding D-01 is that `activate_group` silently regained a
   * `contribution × members × cycle_days` fallback that v8 had removed, so a
   * member could be paid a number nobody chose. A membership with no decided
   * cashout returns `null` here and the caller must refuse.
   */
  execute(actor: Actor, membershipId: MembershipId): Promise<{
    readonly eligible: boolean
    readonly reason: string
    readonly gross: Money | null
    readonly outstandingContributions: Money
    readonly outstandingPenalties: Money
    readonly net: Money | null
    readonly scheduledDate: string | null
  }>
}
