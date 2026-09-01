import type { Obligation } from './types'
import { timingOf } from './types'
import type { MembershipId } from '../membership/types'

/**
 * Allocation policy.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A PARAMETER AND NOT A CONSTANT
 *
 * The order in which a payment settles obligations is a business rule with
 * real money attached, and right now we have two candidate rules that
 * disagree — and no confirmation of which one production actually follows.
 *
 *   LEGACY_SLOT_FIRST  What static analysis says `_shared/settle.ts` does
 *                      today: clear the whole slot the payment came from,
 *                      including its FUTURE days, before touching another
 *                      membership's OVERDUE days.
 *
 *   ARREARS_FIRST      What the specification asks for: overdue everywhere,
 *                      then today, then future.
 *
 * The engine's own header comment claims "arrears before paying ahead,
 * always", which is the second rule. Its queue construction implements the
 * first. One of those is wrong, and which one is authoritative is a business
 * decision that must be made against the Phase 01 production findings — not
 * guessed at from a comment.
 *
 * So the policy is data. Both are defined, both are tested, and neither is
 * marked canonical until that question is settled.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * How far a payment may reach.
 *
 *   'membership' — only the slot the payment was made against. This is what
 *                  the member chooses when they tick "pay this group only".
 *   'member'     — any membership the payer holds, subject to the ordering.
 */
export type AllocationScope = 'membership' | 'member'

/**
 * A single ranking rule. Obligations are sorted by these in order, so the
 * policy reads as a list of tie-breaks.
 */
export type OrderRule =
  /** Obligations belonging to the membership the payment targeted come first. */
  | 'origin-membership-first'
  /** Overdue before due-today before future. */
  | 'arrears-first'
  /** Oldest due date first. */
  | 'due-date-asc'
  /** Deterministic final tie-break so the result never depends on input order. */
  | 'obligation-id-asc'

export interface AllocationPolicy {
  readonly name: string
  readonly scope: AllocationScope
  readonly order: readonly OrderRule[]
  /**
   * Whether a late fee attached to an obligation must be cleared as part of
   * settling that obligation, or is left to be handled separately.
   */
  readonly includePenalties: boolean
  /**
   * Where money goes when every reachable obligation is settled.
   *
   *   'membership-credit' — held against the membership it was paid into, and
   *                         applied to that membership's next obligation. This
   *                         is what §17 requires: groups must not pool money.
   *   'discard'           — returned as unallocated for the caller to decide.
   */
  readonly surplus: 'membership-credit' | 'discard'
  readonly notes: string
}

/**
 * Reproduces the behaviour static analysis attributes to `_shared/settle.ts`.
 *
 * Kept so that, once the Phase 01 outputs land, we can prove the new engine
 * matches production EXACTLY before changing any rule — and then change the
 * rule as a separate, visible decision rather than as a side effect of a
 * rewrite.
 *
 * NOT confirmed against production. NOT canonical.
 */
export const LEGACY_SLOT_FIRST: AllocationPolicy = {
  name: 'legacy-slot-first',
  scope: 'member',
  order: ['origin-membership-first', 'due-date-asc', 'obligation-id-asc'],
  includePenalties: true,
  surplus: 'membership-credit',
  notes:
    'Mirrors settle.ts as read statically: the originating slot is cleared in ' +
    'full — future days included — before any other membership is touched. ' +
    'This contradicts that file\'s own stated "arrears before paying ahead" ' +
    'rule. Unverified against production.',
}

/**
 * The ordering the specification asks for: nobody pays a future day anywhere
 * while they still owe a past one somewhere.
 *
 * NOT yet adopted. Adopting it is a behaviour change affecting real balances
 * and needs an explicit decision plus a dual-run against production.
 */
export const ARREARS_FIRST: AllocationPolicy = {
  name: 'arrears-first',
  scope: 'member',
  order: ['arrears-first', 'due-date-asc', 'origin-membership-first', 'obligation-id-asc'],
  includePenalties: true,
  surplus: 'membership-credit',
  notes:
    'Overdue obligations across every membership are settled before today, ' +
    'and today before any future day. Matches the written specification and ' +
    "settle.ts's own header comment, but not settle.ts's implementation.",
}

/**
 * A payment the member explicitly restricted to one group. Reaches nothing
 * else, whatever the ordering rules would otherwise permit.
 */
export const THIS_MEMBERSHIP_ONLY: AllocationPolicy = {
  name: 'this-membership-only',
  scope: 'membership',
  order: ['arrears-first', 'due-date-asc', 'obligation-id-asc'],
  includePenalties: true,
  surplus: 'membership-credit',
  notes:
    'Corresponds to the existing this_group_only flag. Money never leaves the ' +
    'membership it was paid into; any surplus becomes that membership\'s credit.',
}

export const POLICIES = {
  [LEGACY_SLOT_FIRST.name]:    LEGACY_SLOT_FIRST,
  [ARREARS_FIRST.name]:        ARREARS_FIRST,
  [THIS_MEMBERSHIP_ONLY.name]: THIS_MEMBERSHIP_ONLY,
} as const

// ── Ranking ────────────────────────────────────────────────────────────────

export interface RankContext {
  /** The membership the payment was made against, if any. */
  readonly originMembershipId: MembershipId | null
  /** The day the payment is being applied, `YYYY-MM-DD`. */
  readonly asOf: string
}

const TIMING_RANK = { overdue: 0, 'due-today': 1, future: 2 } as const

function scoreFor(rule: OrderRule, o: Obligation, ctx: RankContext): number | string {
  switch (rule) {
    case 'origin-membership-first':
      return ctx.originMembershipId && o.membershipId === ctx.originMembershipId ? 0 : 1
    case 'arrears-first':
      return TIMING_RANK[timingOf(o, ctx.asOf)]
    case 'due-date-asc':
      return o.dueDate
    case 'obligation-id-asc':
      return o.id
  }
}

/**
 * Order obligations for settlement. Pure and total: the same inputs always
 * produce the same order, and `obligation-id-asc` guarantees the result never
 * depends on the order rows came back from the database.
 */
export function rankObligations(
  obligations: readonly Obligation[],
  policy: AllocationPolicy,
  ctx: RankContext,
): Obligation[] {
  const rules = policy.order.includes('obligation-id-asc')
    ? policy.order
    : [...policy.order, 'obligation-id-asc' as const]

  return [...obligations].sort((a, b) => {
    for (const rule of rules) {
      const sa = scoreFor(rule, a, ctx)
      const sb = scoreFor(rule, b, ctx)
      if (sa < sb) return -1
      if (sa > sb) return 1
    }
    return 0
  })
}
