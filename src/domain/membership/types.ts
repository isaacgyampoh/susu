import type { Money } from '../shared/money'

/**
 * The membership model.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The shape here is deliberate and load-bearing:
 *
 *     Member ──< Membership >── Group
 *
 * A Membership is a SLOT, not a group. One person holds one membership per
 * slot, and may hold several slots in the same group — each with its own
 * payout position, its own schedule, and its own money. There is deliberately
 * no `Member.groupId` and no `Member.group`: the types must make the wrong
 * model unrepresentable, because that is the assumption the portal has to stop
 * making.
 *
 * The financial state of a membership is its own. Nothing in this file lets
 * one membership's balance reach another's — see the isolation tests.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type MemberId     = string & { readonly __brand: 'MemberId' }
export type MembershipId = string & { readonly __brand: 'MembershipId' }
export type GroupId      = string & { readonly __brand: 'GroupId' }

/**
 * Branded-id helpers. These are compile-time only — they cost nothing at
 * runtime but stop a groupId being passed where a membershipId belongs, which
 * is a mistake the existing code makes in several places because everything is
 * a bare `string`.
 */
export const asMemberId     = (v: string) => v as MemberId
export const asMembershipId = (v: string) => v as MembershipId
export const asGroupId      = (v: string) => v as GroupId

/** Matches the `membership_status` enum in the database. */
export type MembershipStatus = 'active' | 'defaulted' | 'completed'

/** Matches `contribution_freq`. */
export type ContributionFrequency = 'daily' | 'weekly' | 'monthly'

/**
 * A slot may be a quarter, a half, or whole. A fractional slot pays that
 * fraction of the daily contribution and collects that fraction of the
 * cashout, while still owning a full turn in the rotation.
 *
 * Constrained in the database by CHECK (slot_fraction IN (0.25, 0.5, 1)).
 */
export type SlotFraction = 0.25 | 0.5 | 1
export const SLOT_FRACTIONS: readonly SlotFraction[] = [0.25, 0.5, 1]
export const isSlotFraction = (v: unknown): v is SlotFraction =>
  SLOT_FRACTIONS.includes(v as SlotFraction)

/** The group's terms. Read-only from the domain's point of view. */
export interface GroupTerms {
  readonly id: GroupId
  readonly name: string
  /** A FULL slot's contribution per period. Fractional slots scale from this. */
  readonly contributionAmount: Money
  readonly frequency: ContributionFrequency
  /** Days between one member's payout and the next. */
  readonly cycleDays: number
  readonly maxMembers: number
  /**
   * What a FULL slot collects on its turn. Set by the operator, never derived.
   * `null` means the operator has not decided yet — and a group in that state
   * must not be activated or advertised.
   */
  readonly cashoutAmount: Money | null
  readonly registrationFee: Money
  /** "18:00" — after this, the day is late. */
  readonly paymentDeadline: string
  readonly penaltyPerLateDay: Money
  readonly startDate: string | null
}

/** One slot held by one member in one group. The unit of financial identity. */
export interface Membership {
  readonly id: MembershipId
  readonly memberId: MemberId
  readonly groupId: GroupId
  readonly status: MembershipStatus
  /** Position in the rotation. Unique within a group. */
  readonly payoutPosition: number
  readonly slotFraction: SlotFraction
  readonly payoutDate: string | null
  /** What THIS slot collects — cashout scaled by its fraction. */
  readonly payoutAmount: Money | null
  readonly payoutReceived: boolean
  readonly joinedAt: string
  /** Slots sharing one turn in the rotation move their payout dates together. */
  readonly sharedSlotKey: string | null
}

/** This slot's contribution per period, scaled for a fractional slot. */
export function contributionFor(membership: Membership, terms: GroupTerms): Money {
  return terms.contributionAmount.times(membership.slotFraction, 'half-up')
}

/** What this slot collects on its turn. Null when the operator has not decided. */
export function cashoutFor(membership: Membership, terms: GroupTerms): Money | null {
  if (membership.payoutAmount) return membership.payoutAmount
  if (!terms.cashoutAmount) return null
  return terms.cashoutAmount.times(membership.slotFraction, 'half-up')
}

export interface Member {
  readonly id: MemberId
  readonly memberCode: string
  readonly fullName: string
  readonly phone: string
  readonly status: 'pending' | 'active' | 'suspended' | 'removed'
  readonly mobileMoneyNumber: string | null
  readonly mobileMoneyProvider: string | null
}

/**
 * A member and every slot they hold. This is what the portal renders.
 *
 * `memberships` is a list because it always was — the database has never had a
 * one-group-per-member constraint. The type exists so no consumer can quietly
 * assume `memberships[0]` is "the" membership.
 */
export interface MemberWithMemberships {
  readonly member: Member
  readonly memberships: readonly Membership[]
}
