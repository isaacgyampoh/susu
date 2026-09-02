import { Money, ghs } from '../shared/money'
import { asGroupId, asMembershipId, type MembershipId } from '../membership/types'
import { asObligationId, type Obligation, type ObligationStatus } from './types'

/**
 * Test fixtures. Kept beside the domain rather than in a test file because the
 * conformance suite that will bind the pure allocator to the SQL settlement
 * needs to build the same scenarios on both sides.
 */

/** A run of consecutive daily obligations for one membership. */
export function dailySchedule(opts: {
  membership: string
  group?: string
  groupName?: string
  /** `YYYY-MM-DD` of the first day. */
  from: string
  days: number
  /** Cost per day. */
  amount: Money
  /** Days already settled, counted from `from`. */
  paidDays?: number
  /** Extra part-payment applied to the first unsettled day. */
  partialOnNext?: Money
  penalty?: Money
  /** Anything before this date is 'overdue' rather than 'pending'. */
  asOf?: string
}): Obligation[] {
  const {
    membership, group = `grp-${membership}`, groupName = `Group ${membership.toUpperCase()}`,
    from, days, amount, paidDays = 0, partialOnNext, penalty = Money.zero(), asOf,
  } = opts

  const out: Obligation[] = []
  for (let i = 0; i < days; i++) {
    const dueDate = addDays(from, i)
    const settled = i < paidDays
    const isNextUnsettled = i === paidDays

    let amountPaid = settled ? amount : Money.zero()
    if (isNextUnsettled && partialOnNext) amountPaid = partialOnNext

    let status: ObligationStatus = settled ? 'paid' : 'pending'
    if (!settled && asOf && dueDate < asOf) status = 'overdue'

    out.push({
      id: asObligationId(`${membership}-${dueDate}`),
      membershipId: asMembershipId(membership),
      groupId: asGroupId(group),
      groupName,
      dueDate,
      amount,
      amountPaid,
      penalty: settled ? Money.zero() : penalty,
      status,
    })
  }
  return out
}

/** One obligation, spelled out. */
export function obligation(opts: {
  id?: string
  membership: string
  group?: string
  groupName?: string
  dueDate: string
  amount: Money
  amountPaid?: Money
  penalty?: Money
  status?: ObligationStatus
}): Obligation {
  return {
    id: asObligationId(opts.id ?? `${opts.membership}-${opts.dueDate}`),
    membershipId: asMembershipId(opts.membership),
    groupId: asGroupId(opts.group ?? `grp-${opts.membership}`),
    groupName: opts.groupName ?? `Group ${opts.membership.toUpperCase()}`,
    dueDate: opts.dueDate,
    amount: opts.amount,
    amountPaid: opts.amountPaid ?? Money.zero(),
    penalty: opts.penalty ?? Money.zero(),
    status: opts.status ?? 'pending',
  }
}

/** Credit map from a plain object, for readable tests. */
export function creditOf(entries: Record<string, number>): Map<MembershipId, Money> {
  const m = new Map<MembershipId, Money>()
  for (const [k, v] of Object.entries(entries)) m.set(asMembershipId(k), ghs(v))
  return m
}

export const noCredit = (): Map<MembershipId, Money> => new Map()

/** UTC date arithmetic — no timezone can shift a due date here. */
export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y!, m! - 1, d!))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}
