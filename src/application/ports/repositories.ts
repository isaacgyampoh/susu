import type { Money } from '../../domain/shared/money'
import type {
  GroupId, GroupTerms, Member, MemberId, Membership, MembershipId,
} from '../../domain/membership/types'
import type { Obligation } from '../../domain/contribution/types'
import type {
  Payment, PaymentAllocation, PaymentId, MembershipCredit,
} from '../../domain/payment/types'

/**
 * Repository ports.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * These are interfaces the APPLICATION owns and INFRASTRUCTURE implements —
 * the dependency points inward. `src/infrastructure/supabase/` will provide
 * the concrete versions; nothing in this file knows Supabase exists.
 *
 * There is deliberately NOT one repository per table. A repository marks an
 * aggregate boundary — a cluster of data that is written together and must
 * stay consistent — not a row shape. So:
 *
 *   - Payment and PaymentAllocation share one repository. An allocation has no
 *     life of its own; it is only ever written as part of settling a payment.
 *     Splitting them would invite exactly the partial write that produced
 *     finding F-02, where allocations exist for days that were never marked
 *     paid.
 *
 *   - There is no AnnouncementRepository, SmsLogRepository or AuditRepository
 *     here. They are real tables, but nothing in the financial domain reads
 *     them, so an interface would be ceremony.
 *
 * Every method that reads money returns domain `Money`, never a number or a
 * string. Conversion happens at the infrastructure edge, once.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface MemberRepository {
  findById(id: MemberId): Promise<Member | null>
  findByPhone(phone: string): Promise<Member | null>
}

export interface MembershipRepository {
  findById(id: MembershipId): Promise<Membership | null>
  /**
   * Every slot a member holds. The portal's entry point — and the reason this
   * returns a list with no "primary" concept anywhere in sight.
   */
  findActiveByMember(memberId: MemberId): Promise<Membership[]>
  findByGroup(groupId: GroupId): Promise<Membership[]>
  /** Group terms for a set of memberships, fetched together to avoid an N+1. */
  termsFor(groupIds: readonly GroupId[]): Promise<Map<GroupId, GroupTerms>>
}

export interface ContributionRepository {
  /**
   * Unsettled obligations for specific memberships.
   *
   * Takes a LIST of membership ids, not one, because the alternative is the
   * N+1 that makes the portal issue 26 round trips for a member in ten groups.
   * The signature makes the efficient call the natural one.
   */
  findUnsettled(membershipIds: readonly MembershipId[]): Promise<Obligation[]>

  /** Every obligation for one membership — the group detail screen. */
  findAllForMembership(membershipId: MembershipId): Promise<Obligation[]>

  /**
   * Aggregate position per membership, computed in the database.
   *
   * This exists so no caller is ever tempted to fetch rows and sum them in
   * JavaScript — the mistake behind the "last 50 rows" member total and the
   * unbounded admin "Total collected".
   */
  positionsFor(membershipIds: readonly MembershipId[]): Promise<Map<MembershipId, {
    totalExpected: Money
    totalPaid: Money
    totalOutstanding: Money
    overdue: Money
    obligationCount: number
    settledCount: number
  }>>
}

export interface PaymentRepository {
  findById(id: PaymentId): Promise<Payment | null>
  /** By OUR reference — the idempotency key. */
  findByReference(reference: string): Promise<Payment | null>
  /** By the provider's reference, for webhook and reconciliation lookups. */
  findByProviderReference(providerReference: string): Promise<Payment | null>

  /** Record the intent, before any money is requested. */
  create(payment: Payment): Promise<Payment>

  /**
   * Settle a payment and write its allocations ATOMICALLY.
   *
   * One method, not "mark paid" plus "insert allocations", because the whole
   * lesson of F-02 is that those must not be separable. The implementation
   * runs inside a single database transaction with the obligation rows locked.
   */
  settleAtomically(input: {
    paymentId: PaymentId
    allocations: readonly PaymentAllocation[]
    creditAfter: ReadonlyMap<MembershipId, Money>
    settledAt: string
  }): Promise<void>

  /** What a payment covered. The audit answer. */
  allocationsFor(paymentId: PaymentId): Promise<PaymentAllocation[]>
  /** Recent payments with their allocations, for the member's history. */
  historyForMember(memberId: MemberId, limit: number): Promise<{
    payment: Payment
    allocations: PaymentAllocation[]
  }[]>
}

export interface MembershipCreditRepository {
  /** Credit held per membership. Never per member — groups do not pool money. */
  balancesFor(membershipIds: readonly MembershipId[]): Promise<Map<MembershipId, Money>>
  get(membershipId: MembershipId): Promise<MembershipCredit | null>
}

export interface PayoutRepository {
  findByMembership(membershipId: MembershipId): Promise<{
    scheduledDate: string
    amount: Money
    status: 'upcoming' | 'processing' | 'paid'
    paidAt: string | null
  }[]>
  upcomingForMember(memberId: MemberId): Promise<Map<MembershipId, {
    scheduledDate: string
    amount: Money
  }>>
}

export interface RegistrationRepository {
  findById(id: string): Promise<{
    id: string
    fullName: string
    phone: string
    status: 'pending' | 'approved' | 'rejected'
    registrationFeePaid: boolean
    registrationFeeAmount: Money
    selectedGroupIds: readonly GroupId[]
    createdMemberId: MemberId | null
  } | null>
}
