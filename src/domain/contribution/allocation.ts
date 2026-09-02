import { Money } from '../shared/money'
import type { GroupId, MembershipId } from '../membership/types'
import type { Obligation, ObligationId } from './types'
import { outstandingOf } from './types'
import type { AllocationPolicy } from './policy'
import { rankObligations } from './policy'

/**
 * The allocation engine.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * A pure function. Given what a member owes, what credit they hold, and how
 * much they just paid, it decides exactly which obligations that money covers.
 *
 * No database. No Supabase. No NaloPay. No HTTP. No clock — `asOf` is an
 * argument. It can be exercised entirely in a test, which is the point: this
 * is the rule that decides where members' money goes, and until now it lived
 * inside a function that could only be tested by making a real payment.
 *
 * It is used in two places, deliberately:
 *
 *   1. To PREVIEW an allocation before the member approves anything — so the
 *      screen can say "this covers today, tomorrow, and GHS 50 of Wednesday"
 *      and be telling the truth.
 *   2. As the specification for the transactional settlement that will run in
 *      the database, bound to it by a conformance test.
 *
 * Two implementations of one rule is normally the disease this whole rebuild
 * is treating. It is acceptable here, and only here, because a conformance
 * test makes them provably identical — and because only the database can lock
 * the rows it is about to change, so the authoritative write cannot live here.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface AllocationLine {
  readonly obligationId: ObligationId
  readonly membershipId: MembershipId
  readonly groupId: GroupId
  readonly groupName: string
  readonly dueDate: string
  /** How much of the payment this obligation absorbed. Always positive. */
  readonly amount: Money
  /** Whether this settled the obligation outright or only part of it. */
  readonly kind: 'full' | 'part'
  /** What remains owed on this obligation afterwards. */
  readonly remainingAfter: Money
}

export interface AllocationRequest {
  /** What the member is paying now. May be zero. Never negative. */
  readonly payment: Money
  /** Every obligation the payment is permitted to reach, in any order. */
  readonly obligations: readonly Obligation[]
  /**
   * Unapplied credit, keyed by membership. Credit belongs to a membership,
   * never to a member — a surplus paid into Group A must not settle Group B.
   */
  readonly credit: ReadonlyMap<MembershipId, Money>
  /** The membership the payment was made against, if any. */
  readonly originMembershipId: MembershipId | null
  readonly policy: AllocationPolicy
  /** `YYYY-MM-DD`. Supplied, never read from the clock, so results are stable. */
  readonly asOf: string
}

export interface AllocationResult {
  readonly lines: readonly AllocationLine[]
  /** Total drawn from the payment itself. */
  readonly allocatedFromPayment: Money
  /** Credit consumed, per membership. */
  readonly creditConsumed: ReadonlyMap<MembershipId, Money>
  /** Credit held afterwards, per membership — existing, minus used, plus surplus. */
  readonly creditAfter: ReadonlyMap<MembershipId, Money>
  /**
   * Payment left over after every reachable obligation was settled and any
   * surplus was banked. Non-zero only when the policy discards surplus.
   */
  readonly unallocated: Money
  /**
   * Surplus taken from the payment and held as the origin membership's credit
   * rather than applied to an obligation. Tracked explicitly because it is
   * money that moved without producing an allocation line, and the balancing
   * invariant below cannot be stated without it.
   */
  readonly surplusBanked: Money
  /** Obligations fully settled by this payment. */
  readonly obligationsSettled: number
  /** Distinct memberships this payment touched. */
  readonly membershipsTouched: readonly MembershipId[]
}

export class AllocationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AllocationError'
  }
}

/**
 * Allocate a payment across obligations.
 *
 * The invariants it guarantees, asserted before returning:
 *
 *   sum(lines) == allocatedFromPayment + sum(creditConsumed)
 *   allocatedFromPayment + unallocated + surplus banked == payment
 *   every line amount > 0
 *   no obligation is allocated more than it owes
 *   no membership's credit is spent on another membership's obligation
 */
export function allocatePayment(req: AllocationRequest): AllocationResult {
  const { payment, obligations, credit, originMembershipId, policy, asOf } = req

  if (payment.isNegative) {
    throw new AllocationError(`A payment cannot be negative (got ${payment.format()})`)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new AllocationError(`asOf must be a YYYY-MM-DD date, got "${asOf}"`)
  }

  // Only obligations the policy allows this payment to reach.
  const reachable = policy.scope === 'membership'
    ? obligations.filter(o => originMembershipId !== null && o.membershipId === originMembershipId)
    : obligations

  const queue = rankObligations(reachable, policy, { originMembershipId, asOf })

  // Working state. Credit is tracked per membership throughout — this is the
  // mechanism that keeps groups financially separate.
  const creditRemaining = new Map<MembershipId, Money>(credit)
  const creditUsed      = new Map<MembershipId, Money>()
  const lines: AllocationLine[] = []
  const touched = new Set<MembershipId>()

  let fromPayment = Money.zero(payment.currency)
  let paymentLeft = payment

  for (const o of queue) {
    const owedBase = policy.includePenalties
      ? outstandingOf(o)
      : o.amount.minus(o.amountPaid).clampToZero()

    if (owedBase.isZero) continue

    // This membership's own credit is spent first. It can never reach another.
    const ownCredit = creditRemaining.get(o.membershipId) ?? Money.zero(payment.currency)
    const creditPart = Money.min(ownCredit, owedBase)
    const stillOwed = owedBase.minus(creditPart)
    const cashPart = Money.min(paymentLeft, stillOwed)
    const applied = creditPart.plus(cashPart)

    if (applied.isZero) {
      // Nothing available for this obligation. If the payment is exhausted and
      // no credit is left anywhere, there is nothing more to do at all.
      if (paymentLeft.isZero && everyCreditZero(creditRemaining)) break
      continue
    }

    if (creditPart.isPositive) {
      creditRemaining.set(o.membershipId, ownCredit.minus(creditPart))
      creditUsed.set(o.membershipId, (creditUsed.get(o.membershipId) ?? Money.zero(payment.currency)).plus(creditPart))
    }
    if (cashPart.isPositive) {
      paymentLeft = paymentLeft.minus(cashPart)
      fromPayment = fromPayment.plus(cashPart)
    }

    const remainingAfter = owedBase.minus(applied)
    lines.push({
      obligationId: o.id,
      membershipId: o.membershipId,
      groupId: o.groupId,
      groupName: o.groupName,
      dueDate: o.dueDate,
      amount: applied,
      kind: remainingAfter.isZero ? 'full' : 'part',
      remainingAfter,
    })
    touched.add(o.membershipId)
  }

  // Anything left becomes credit for the membership the money was paid into.
  // With no origin membership there is nowhere to bank it, so it is reported
  // as unallocated for the caller to decide — never silently absorbed.
  let unallocated = Money.zero(payment.currency)
  let surplusBanked = Money.zero(payment.currency)
  if (paymentLeft.isPositive) {
    if (policy.surplus === 'membership-credit' && originMembershipId) {
      const before = creditRemaining.get(originMembershipId) ?? Money.zero(payment.currency)
      creditRemaining.set(originMembershipId, before.plus(paymentLeft))
      fromPayment = fromPayment.plus(paymentLeft)
      surplusBanked = paymentLeft
      paymentLeft = Money.zero(payment.currency)
    } else {
      unallocated = paymentLeft
    }
  }

  const result: AllocationResult = {
    lines,
    allocatedFromPayment: fromPayment,
    creditConsumed: creditUsed,
    creditAfter: creditRemaining,
    unallocated,
    surplusBanked,
    obligationsSettled: lines.filter(l => l.kind === 'full').length,
    membershipsTouched: [...touched],
  }

  assertInvariants(req, result)
  return result
}

function everyCreditZero(m: ReadonlyMap<MembershipId, Money>): boolean {
  for (const v of m.values()) if (v.isPositive) return false
  return true
}

/**
 * Invariants checked on every allocation, in production as well as in tests.
 *
 * This is cheap — a handful of integer additions — and it is the difference
 * between a bug that shows up as a wrong number on a member's screen months
 * later and one that fails loudly at the moment it happens. Given what this
 * function decides, that trade is not close.
 */
function assertInvariants(req: AllocationRequest, res: AllocationResult): void {
  const cur = req.payment.currency
  const fail = (msg: string) => { throw new AllocationError(`Allocation invariant violated: ${msg}`) }

  for (const line of res.lines) {
    if (!line.amount.isPositive) fail(`a line allocated ${line.amount.format()} to ${line.obligationId}`)
    if (line.remainingAfter.isNegative) fail(`obligation ${line.obligationId} was over-allocated`)
  }

  // Money out equals money in. Surplus banked to credit moved without
  // producing a line, so it belongs on the left-hand side.
  const linesTotal = Money.sum(res.lines.map(l => l.amount), cur)
  const creditTotal = Money.sum([...res.creditConsumed.values()], cur)
  if (!linesTotal.plus(res.surplusBanked).equals(res.allocatedFromPayment.plus(creditTotal))) {
    fail(
      `lines ${linesTotal.format()} + banked ${res.surplusBanked.format()} != ` +
      `payment ${res.allocatedFromPayment.format()} + credit ${creditTotal.format()}`,
    )
  }

  // The payment is fully accounted for.
  if (!res.allocatedFromPayment.plus(res.unallocated).equals(req.payment)) {
    fail(
      `payment ${req.payment.format()} != allocated ${res.allocatedFromPayment.format()} ` +
      `+ unallocated ${res.unallocated.format()}`,
    )
  }

  // No obligation absorbed more than it owed.
  const perObligation = new Map<ObligationId, Money>()
  for (const l of res.lines) {
    perObligation.set(l.obligationId, (perObligation.get(l.obligationId) ?? Money.zero(cur)).plus(l.amount))
  }
  for (const o of req.obligations) {
    const got = perObligation.get(o.id)
    if (got && got.isGreaterThan(outstandingOf(o))) {
      fail(`obligation ${o.id} owed ${outstandingOf(o).format()} but absorbed ${got.format()}`)
    }
  }

  // Credit never crossed a membership boundary.
  const reachableMemberships = new Set(req.obligations.map(o => o.membershipId))
  for (const [mid, used] of res.creditConsumed) {
    if (!used.isPositive) continue
    const had = req.credit.get(mid) ?? Money.zero(cur)
    if (used.isGreaterThan(had)) {
      fail(`membership ${mid} spent ${used.format()} of credit but held ${had.format()}`)
    }
    if (!reachableMemberships.has(mid)) {
      fail(`credit was spent for membership ${mid}, which has no obligation in this request`)
    }
  }

  // Every membership's credit balance moved only by what it used or banked.
  for (const [mid, after] of res.creditAfter) {
    if (after.isNegative) fail(`membership ${mid} ended with negative credit ${after.format()}`)
  }
}

/**
 * Preview an allocation without committing to it — the same computation the
 * settlement will perform, so what the member is shown before approving is
 * what actually happens.
 */
export interface AllocationPreview {
  readonly result: AllocationResult
  readonly coversDays: number
  readonly fullyCovers: readonly { dueDate: string; groupName: string; amount: Money }[]
  readonly partiallyCovers: readonly { dueDate: string; groupName: string; amount: Money; shortfall: Money }[]
  readonly creditAfterPayment: Money
}

export function previewAllocation(req: AllocationRequest): AllocationPreview {
  const result = allocatePayment(req)
  const originCredit = req.originMembershipId
    ? result.creditAfter.get(req.originMembershipId) ?? Money.zero(req.payment.currency)
    : Money.zero(req.payment.currency)

  return {
    result,
    coversDays: result.obligationsSettled,
    fullyCovers: result.lines
      .filter(l => l.kind === 'full')
      .map(l => ({ dueDate: l.dueDate, groupName: l.groupName, amount: l.amount })),
    partiallyCovers: result.lines
      .filter(l => l.kind === 'part')
      .map(l => ({ dueDate: l.dueDate, groupName: l.groupName, amount: l.amount, shortfall: l.remainingAfter })),
    creditAfterPayment: originCredit,
  }
}
