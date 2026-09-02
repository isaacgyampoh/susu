/**
 * The member portal's view model.
 *
 * Mirrors what `get_member_portal_state()` returns, one-to-one. Every money
 * field arrives as a number from JSON; the portal DISPLAYS these and never
 * does arithmetic on them — all figures, including the cross-membership
 * totals, are computed in the database.
 *
 * The shape is membership-first on purpose. There is no "current group" and no
 * `plans[0]`: a member holds a LIST of memberships, each financially
 * independent, and the portal shows all of them.
 */

/** How an obligation reads to a member. Decided server-side, never inferred. */
export type Coverage =
  | 'paid'
  | 'paid-in-advance'
  | 'paid-today'
  | 'partially-covered'
  | 'due-today'
  | 'overdue'
  | 'upcoming'
  /** The membership's group has never been activated, so no schedule exists. */
  | 'no-schedule'

export interface NextObligation {
  id: string
  due_date: string
  amount: number
  amount_paid: number
  penalty: number
  /** What is still owed on it. The number the member must act on. */
  remaining: number
  status: 'pending' | 'paid' | 'overdue'
}

export interface MembershipView {
  membership_id: string
  group_id: string
  group_name: string
  status: 'active' | 'defaulted' | 'completed'
  slot_fraction: number
  payout_position: number
  /** Null means the operator has not set one. NEVER fabricate a date. */
  payout_date: string | null
  /** The membership's own figure where an override exists; the group default otherwise. */
  payout_amount: number | null
  payout_received: boolean
  contribution_amount: number
  frequency: 'daily' | 'weekly' | 'monthly'
  payment_deadline: string

  /** Owed for today on THIS membership, after anything already paid toward it. */
  due_today: number
  paid_today: number
  total_paid: number
  total_expected: number
  total_outstanding: number
  overdue: number
  /** Money sitting against days that are not yet due. */
  paid_in_advance: number
  /** Whole future days already settled. */
  days_covered_ahead: number
  obligations: number
  obligations_settled: number
  /** Unapplied credit held by THIS membership. Never shared with another. */
  advance_credit: number

  next_obligation: NextObligation | null
  coverage: Coverage
}

export interface PortalTotals {
  /*
   * Today, in three figures. One is not enough: a member holding several groups
   * cannot work out what they owed and what they have paid from what is left.
   *
   *     obligation_today − paid_today = remaining_today
   */
  /** Everything today asks for, across every membership. */
  obligation_today: number
  /** What has already been paid towards today. */
  paid_today: number
  /** What is still to pay today. */
  remaining_today: number
  /** @deprecated Same value as `remaining_today`, kept for existing callers. */
  due_today: number
  paid_all_time: number
  outstanding: number
  expected: number
  overdue: number
  advance_credit: number
  active_memberships: number
}

/** One MoMo payment and the obligations it settled. */
export interface PaymentRecord {
  reference: string
  at: string
  total: number
  items: {
    group: string
    membership_id: string
    due_date: string
    amount: number
    kind: 'full' | 'part'
  }[]
}

export interface PortalState {
  as_of: string
  member: {
    id: string
    member_code: string
    full_name: string
    phone: string
    status: string
    mobile_money_number: string | null
    mobile_money_provider: string | null
    /* Merged in by member-profile from the `members` row — the profile screen
       shows these, the other screens do not need them. All optional: a member
       may have given none of them at registration. */
    email?: string | null
    occupation?: string | null
    residential_address?: string | null
    whatsapp_number?: string | null
    created_at?: string | null
  }
  memberships: MembershipView[]
  totals: PortalTotals
  payments: PaymentRecord[]
  penalties: { id: string; amount: number; reason: string; susu_groups?: { name: string } }[]
  /** Payouts on record for this member. `paid_at` is null until one is paid. */
  payouts: {
    id: string
    total_amount: number
    status: 'upcoming' | 'processing' | 'paid'
    scheduled_date: string | null
    paid_at: string | null
    susu_groups?: { name: string } | null
  }[]
  announcements: { id: string; title: string; content: string; created_at: string }[]
  myMessages: {
    id: string; subject: string; message: string
    reply_text?: string; created_at: string
  }[]
}

/** What a payment will cover, from `preview_settlement()`. */
export interface PaymentPreview {
  reference: string
  amount: number
  covers: {
    contribution_id: string
    membership_id: string
    group_name: string
    due_date: string
    amount: number
    kind: 'full' | 'part'
    /** Still owed on that day after this payment. Non-zero on a partial. */
    remaining_after: number
  }[]
  days_fully_covered: number
  days_partly_covered: number
  total_allocated: number
  credit_after: number
  memberships_touched: number
}
