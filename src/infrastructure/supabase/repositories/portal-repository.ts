import { adminClient } from '../client'
import { toMoney } from '../mappers/money'
import { Money } from '../../../domain/shared/money'
import {
  asGroupId, asMemberId, asMembershipId,
  type MemberId, type MembershipId,
} from '../../../domain/membership/types'
import { asObligationId, type CoverageState, type Obligation } from '../../../domain/contribution/types'

/**
 * The member portal's read model.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * ONE database round trip, whatever the member's shape. The projection is
 * computed by get_member_portal_state() in PostgreSQL; this class converts the
 * result into domain types and nothing more.
 *
 * What it replaces: member-profile issues 6 fixed queries plus 2 per
 * membership. The member who holds 30 memberships across 18 groups therefore
 * costs 66 round trips to open one screen — over a Ghanaian mobile connection,
 * to an edge function in another region. It also computed "Paid so far" by
 * summing a 50-row window, which for that member is under two days per group.
 * Both defects are structural, and both disappear by asking the database the
 * question instead of assembling the answer here.
 *
 * There is deliberately no fallback query. If the projection function is
 * missing, this throws — it does not quietly try something else and return a
 * different number under the same name. That pattern exists nine times in the
 * legacy edge functions and is why the platform's behaviour was
 * environment-dependent.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface MembershipView {
  membershipId: MembershipId
  groupName: string
  status: string
  slotFraction: number
  payoutPosition: number
  payoutDate: string | null
  payoutAmount: Money | null
  payoutReceived: boolean
  contributionAmount: Money
  frequency: string
  paymentDeadline: string
  /** Owed for today, after anything already paid toward it. */
  dueToday: Money
  paidToday: Money
  totalPaid: Money
  totalExpected: Money
  totalOutstanding: Money
  overdue: Money
  paidInAdvance: Money
  daysCoveredAhead: number
  obligations: number
  obligationsSettled: number
  advanceCredit: Money
  nextObligation: Obligation | null
  coverage: CoverageState | 'no-schedule'
}

export interface PortalView {
  asOf: string
  member: {
    id: MemberId
    memberCode: string
    fullName: string
    phone: string
    status: string
    mobileMoneyNumber: string | null
    mobileMoneyProvider: string | null
  }
  totals: {
    dueToday: Money
    paidAllTime: Money
    outstanding: Money
    expected: Money
    overdue: Money
    advanceCredit: Money
    activeMemberships: number
  }
  memberships: MembershipView[]
}

export class PortalRepository {
  /**
   * @param memberId whose portal to read
   * @param asOf     the day to evaluate against. Passed explicitly so the
   *                 result is deterministic and a statement can be produced
   *                 for a past date.
   */
  async getPortalState(memberId: MemberId, asOf: string): Promise<PortalView> {
    const { data, error } = await adminClient().rpc('get_member_portal_state', {
      p_member_id: memberId,
      p_as_of: asOf,
    })
    if (error) throw new Error(`Could not read portal state: ${error.message}`)
    if (!data) throw new Error(`No portal state returned for member ${memberId}`)

    const d = data as Record<string, any>
    const t = d.totals ?? {}

    return {
      asOf: d.as_of,
      member: {
        id: asMemberId(d.member.id),
        memberCode: d.member.member_code,
        fullName: d.member.full_name,
        phone: d.member.phone,
        status: d.member.status,
        mobileMoneyNumber: d.member.mobile_money_number ?? null,
        mobileMoneyProvider: d.member.mobile_money_provider ?? null,
      },
      totals: {
        dueToday:          toMoney(t.due_today),
        paidAllTime:       toMoney(t.paid_all_time),
        outstanding:       toMoney(t.outstanding),
        expected:          toMoney(t.expected),
        overdue:           toMoney(t.overdue),
        advanceCredit:     toMoney(t.advance_credit),
        activeMemberships: Number(t.active_memberships ?? 0),
      },
      memberships: (d.memberships ?? []).map((m: Record<string, any>): MembershipView => ({
        membershipId:       asMembershipId(m.membership_id),
        groupName:          m.group_name,
        status:             m.status,
        slotFraction:       Number(m.slot_fraction ?? 1),
        payoutPosition:     Number(m.payout_position ?? 0),
        payoutDate:         m.payout_date ?? null,
        payoutAmount:       m.payout_amount == null ? null : toMoney(m.payout_amount),
        payoutReceived:     !!m.payout_received,
        contributionAmount: toMoney(m.contribution_amount),
        frequency:          m.frequency,
        paymentDeadline:    m.payment_deadline,
        dueToday:           toMoney(m.due_today),
        paidToday:          toMoney(m.paid_today),
        totalPaid:          toMoney(m.total_paid),
        totalExpected:      toMoney(m.total_expected),
        totalOutstanding:   toMoney(m.total_outstanding),
        overdue:            toMoney(m.overdue),
        paidInAdvance:      toMoney(m.paid_in_advance),
        daysCoveredAhead:   Number(m.days_covered_ahead ?? 0),
        obligations:        Number(m.obligations ?? 0),
        obligationsSettled: Number(m.obligations_settled ?? 0),
        advanceCredit:      toMoney(m.advance_credit),
        coverage:           m.coverage,
        nextObligation:     m.next_obligation ? {
          id:           asObligationId(m.next_obligation.id),
          membershipId: asMembershipId(m.membership_id),
          groupId:      asGroupId(m.group_id),
          groupName:    m.group_name,
          dueDate:      m.next_obligation.due_date,
          amount:       toMoney(m.next_obligation.amount),
          amountPaid:   toMoney(m.next_obligation.amount_paid),
          penalty:      toMoney(m.next_obligation.penalty),
          status:       m.next_obligation.status,
        } : null,
      })),
    }
  }
}

/**
 * Admin dashboard figures, aggregated in the database.
 *
 * Replaces admin-dashboard's `SELECT amount FROM transactions WHERE
 * status='success'` with no LIMIT, summed in JavaScript — a query that grows
 * without bound and is silently truncated if PostgREST is configured with a
 * row cap. The figure it produced is the operator's headline "Total collected".
 */
export class AdminTotalsRepository {
  async getTotals(asOf: string): Promise<{
    collected:     { allTime: Money; today: Money; thisMonth: Money; payments: number }
    contributions: { expected: Money; paid: Money; outstanding: Money; overdue: Money; dueToday: Money; paidToday: Money }
    members:       { total: number; active: number }
    memberships:   { active: number; defaulted: number }
    payouts:       { paid: Money; upcoming: Money; due7Days: Money }
    anomalies:     Record<string, number>
  }> {
    const { data, error } = await adminClient().rpc('get_admin_totals', { p_as_of: asOf })
    if (error) throw new Error(`Could not read admin totals: ${error.message}`)
    const d = data as Record<string, any>
    return {
      collected: {
        allTime:   toMoney(d.collected.all_time),
        today:     toMoney(d.collected.today),
        thisMonth: toMoney(d.collected.this_month),
        payments:  Number(d.collected.payments ?? 0),
      },
      contributions: {
        expected:    toMoney(d.contributions.expected),
        paid:        toMoney(d.contributions.paid),
        outstanding: toMoney(d.contributions.outstanding),
        overdue:     toMoney(d.contributions.overdue),
        dueToday:    toMoney(d.contributions.due_today),
        paidToday:   toMoney(d.contributions.paid_today),
      },
      members:     { total: Number(d.members.total), active: Number(d.members.active) },
      memberships: { active: Number(d.memberships.active), defaulted: Number(d.memberships.defaulted) },
      payouts: {
        paid:     toMoney(d.payouts.paid),
        upcoming: toMoney(d.payouts.upcoming),
        due7Days: toMoney(d.payouts.due_7_days),
      },
      anomalies: d.anomalies ?? {},
    }
  }
}
