import { supabaseAdmin } from './supabase-admin.ts'

/*
 * The one place money is applied to a member's schedule.
 *
 * Every settlement path — the webhook, the portal's polling, and the manual
 * reconcile — must spread a payment identically, or the same payment records
 * differently depending on which path happened to win. So they all call this.
 *
 * Rules:
 *  - The payment clears its target day first, then spills FORWARD into later
 *    unpaid days of the SAME slot (same membership), oldest first. GHS 300 on
 *    a 100/day plan clears three days; 250 clears two and banks 50 against
 *    the third as a part payment.
 *  - Surplus never crosses slots or groups. Each slot is its own payout
 *    position; money aimed at one must not quietly settle another.
 *  - Penalties on a day are cleared when that day is fully covered.
 *
 * `paidAmount` is the CONTRIBUTION value (what the member intended to save),
 * not the grossed-up amount charged by the provider — the service charge is
 * the operator's fee, not savings.
 */
export async function applyPaymentToSchedule(
  startContributionId: string,
  paidAmount: number,
  reference: string,
): Promise<{ daysCleared: number; partBanked: number; unallocated: number; groups: string[] }> {
  const now = new Date().toISOString()

  const { data: start } = await supabaseAdmin
    .from('contributions')
    .select('id, amount, amount_paid, penalty_due, membership_id, member_id, due_date, status')
    .eq('id', startContributionId).single()
  if (!start) return { daysCleared: 0, partBanked: 0 }

  // Where the money may go, in order:
  //   1. the day it was sent for
  //   2. the rest of that slot's unpaid days, oldest first
  //   3. the member's other groups and slots, oldest debt first
  //
  // Reaching across groups is deliberate. A member sending GHS 500 who owes
  // in three groups means it to clear what they owe, not to sit against one
  // group while the others fall overdue. Order is oldest-first everywhere, so
  // arrears are cleared before anything is paid ahead.
  let queue: any[] = [start]
  if (start.membership_id) {
    const { data: sameSlot } = await supabaseAdmin
      .from('contributions')
      .select('id, amount, amount_paid, penalty_due, membership_id, member_id, due_date, status')
      .eq('membership_id', start.membership_id)
      .in('status', ['pending', 'overdue'])
      .neq('id', startContributionId)
      .order('due_date', { ascending: true })
      .limit(200)
    queue = queue.concat(sameSlot ?? [])
  }
  if (start.member_id) {
    const { data: otherSlots } = await supabaseAdmin
      .from('contributions')
      .select('id, amount, amount_paid, penalty_due, membership_id, member_id, due_date, status')
      .eq('member_id', start.member_id)
      .in('status', ['pending', 'overdue'])
      .neq('membership_id', start.membership_id ?? '')
      .order('due_date', { ascending: true })
      .limit(400)
    queue = queue.concat(otherSlots ?? [])
  }

  let left = paidAmount
  let daysCleared = 0
  let partBanked = 0
  const touched = new Set<string>()

  for (const c of queue) {
    if (left <= 0.001) break
    if (c.status === 'paid') continue
    const owed = Number(c.amount) + Number(c.penalty_due ?? 0) - Number(c.amount_paid ?? 0)
    if (owed <= 0.001) continue

    if (left + 0.001 >= owed) {
      await supabaseAdmin.from('contributions').update({
        status: 'paid', paid_at: now, paystack_ref: reference,
        amount_paid: Number(c.amount),
      }).eq('id', c.id)
      await supabaseAdmin.from('payment_penalties')
        .update({ is_paid: true, paid_at: now })
        .eq('contribution_id', c.id).then(() => {}, () => {})
      left -= owed
      daysCleared++
      if (c.membership_id) touched.add(String(c.membership_id))
    } else {
      await supabaseAdmin.from('contributions')
        .update({ amount_paid: Number(c.amount_paid ?? 0) + left })
        .eq('id', c.id)
      partBanked = left
      if (c.membership_id) touched.add(String(c.membership_id))
      left = 0
    }
  }

  // Anything still unspent is money the member does not currently owe —
  // reported so it can be shown as credit rather than silently kept.
  return {
    daysCleared, partBanked,
    unallocated: Math.round(left * 100) / 100,
    groups: [...touched],
  }
}

/**
 * Claim a transaction for settlement.
 *
 * Three paths can settle the same payment — the provider's callback, the
 * member's app polling, and the ten-minute sweeper — and any two can run at
 * the same moment. Each was flipping the row to success and then sending its
 * own receipt, which is why members were getting the same confirmation twice
 * and believing they had been charged twice.
 *
 * The update is conditional on the row still being pending, so exactly one
 * caller can win. Only the winner sends messages; the losers stop quietly.
 * Returns true if this caller claimed it.
 */
export async function claimTransaction(txId: string, extra: Record<string, unknown> = {}): Promise<boolean> {
  const { data: current } = await supabaseAdmin
    .from('transactions').select('paystack_data').eq('id', txId).single()

  const { data, error } = await supabaseAdmin
    .from('transactions')
    .update({ status: 'success',
              paystack_data: { ...((current?.paystack_data as Record<string, unknown>) ?? {}), ...extra } as never })
    .eq('id', txId)
    .eq('status', 'pending')      // the guard: whoever gets here first wins
    .select('id')

  if (error) { console.error('claim failed', error.message); return false }
  return (data ?? []).length > 0
}
