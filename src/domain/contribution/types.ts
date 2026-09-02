import type { Money } from '../shared/money'
import type { GroupId, MembershipId } from '../membership/types'

/**
 * A contribution obligation: one membership's debt for one period.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Obligations are MATERIALISED, not derived — one row per membership per day,
 * written when the group is activated. That is the existing design and it is
 * the right one: it makes each day individually addressable, individually
 * payable in part, and individually auditable. This type mirrors it.
 *
 * The important property is `amountPaid`. An obligation is not a boolean. It
 * carries how much has been put toward it, which is what makes partial
 * payment and partial advance representable at all:
 *
 *     amount 100.00, amountPaid   0.00  → owed 100.00, nothing paid
 *     amount 100.00, amountPaid  40.00  → owed  60.00, partially covered
 *     amount 100.00, amountPaid 100.00  → settled
 *
 * A future-dated obligation with amountPaid > 0 is exactly "paid in advance".
 * No separate state, no separate table.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type ObligationId = string & { readonly __brand: 'ObligationId' }
export const asObligationId = (v: string) => v as ObligationId

/** Matches the `contribution_status` enum. */
export type ObligationStatus = 'pending' | 'paid' | 'overdue'

export interface Obligation {
  readonly id: ObligationId
  readonly membershipId: MembershipId
  readonly groupId: GroupId
  /** The name is carried for allocation records; it is not identity. */
  readonly groupName: string
  /** ISO date, `YYYY-MM-DD`. */
  readonly dueDate: string
  /** What this period costs. */
  readonly amount: Money
  /** How much has already been put toward it. */
  readonly amountPaid: Money
  /** Late fee attached to this period, if any. */
  readonly penalty: Money
  readonly status: ObligationStatus
}

/** What is still owed on an obligation, including any penalty. Never negative. */
export function outstandingOf(o: Obligation): Money {
  return o.amount.plus(o.penalty).minus(o.amountPaid).clampToZero()
}

/** True when nothing further is owed. */
export function isSettled(o: Obligation): boolean {
  return outstandingOf(o).isZero
}

/**
 * How an obligation stands relative to a given day.
 *
 * `asOf` is passed in rather than read from the clock so the domain stays
 * pure and every test is deterministic. It also means the same function can
 * answer "how did this look last Tuesday" for a statement.
 */
export type ObligationTiming = 'overdue' | 'due-today' | 'future'

export function timingOf(o: Obligation, asOf: string): ObligationTiming {
  if (o.dueDate < asOf) return 'overdue'
  if (o.dueDate === asOf) return 'due-today'
  return 'future'
}

/**
 * How an obligation should read to a member. This is the vocabulary the portal
 * needs and the current system cannot produce — nothing in the codebase today
 * can answer "is tomorrow covered, and by how much".
 */
export type CoverageState =
  | 'paid'              // settled, on or before its due date
  | 'paid-in-advance'   // settled, and not yet due
  | 'partially-covered' // some money against it, not yet settled
  | 'due-today'
  | 'overdue'
  | 'upcoming'

export function coverageOf(o: Obligation, asOf: string): CoverageState {
  const timing = timingOf(o, asOf)
  if (isSettled(o)) return timing === 'future' ? 'paid-in-advance' : 'paid'
  if (o.amountPaid.isPositive) return 'partially-covered'
  if (timing === 'overdue') return 'overdue'
  if (timing === 'due-today') return 'due-today'
  return 'upcoming'
}

/**
 * The financial position of ONE membership. Every figure is derived from that
 * membership's own obligations — nothing here can be influenced by another
 * membership, which is the isolation guarantee the portal depends on.
 */
export interface MembershipPosition {
  readonly membershipId: MembershipId
  readonly groupId: GroupId
  readonly groupName: string
  /** Owed for today specifically, after anything already paid toward it. */
  readonly dueToday: Money
  readonly paidToday: Money
  /** Everything past due and still owed. */
  readonly overdue: Money
  /** Total ever paid into this membership. */
  readonly totalPaid: Money
  /** Everything still owed, across the whole schedule. */
  readonly totalOutstanding: Money
  /** The full cost of the schedule. */
  readonly totalExpected: Money
  /** Money sitting against obligations not yet due. */
  readonly paidInAdvance: Money
  /** Obligations fully settled ahead of their due date. */
  readonly daysCoveredAhead: number
  /** Unapplied credit held BY THIS MEMBERSHIP. */
  readonly advanceCredit: Money
  readonly nextUnsettled: Obligation | null
  readonly coverage: CoverageState
}
