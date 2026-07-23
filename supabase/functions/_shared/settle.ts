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
): Promise<{ daysCleared: number; partBanked: number }> {
  const now = new Date().toISOString()

  const { data: start } = await supabaseAdmin
    .from('contributions')
    .select('id, amount, amount_paid, penalty_due, membership_id, member_id, due_date, status')
    .eq('id', startContributionId).single()
  if (!start) return { daysCleared: 0, partBanked: 0 }

  let queue: any[] = [start]
  if (start.membership_id) {
    const { data: rest } = await supabaseAdmin
      .from('contributions')
      .select('id, amount, amount_paid, penalty_due, membership_id, member_id, due_date, status')
      .eq('membership_id', start.membership_id)
      .in('status', ['pending', 'overdue'])
      .neq('id', startContributionId)
      .order('due_date', { ascending: true })
      .limit(200)
    queue = queue.concat(rest ?? [])
  }

  let left = paidAmount
  let daysCleared = 0
  let partBanked = 0

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
    } else {
      await supabaseAdmin.from('contributions')
        .update({ amount_paid: Number(c.amount_paid ?? 0) + left })
        .eq('id', c.id)
      partBanked = left
      left = 0
    }
  }

  return { daysCleared, partBanked }
}
