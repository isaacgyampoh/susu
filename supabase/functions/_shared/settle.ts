import { supabaseAdmin } from './supabase-admin.ts'

/*
 * ────────────────────────────────────────────────────────────────────────
 *  THE SETTLEMENT ENGINE — the one and only place money is applied.
 * ────────────────────────────────────────────────────────────────────────
 *
 * Every path that settles a payment calls settlePayment(): the provider
 * callback, the member's app polling, the 10-minute sweeper, the reconcile,
 * and manual admin entry. They must all behave identically, so they all come
 * here. Nothing else marks a contribution paid.
 *
 * What it does, in order:
 *   1. Adds any credit the member is already carrying to the amount.
 *   2. Clears the day the payment was for, then the rest of that slot
 *      (oldest first), then — unless scope is 'slot' — the member's other
 *      groups (oldest debt first). Arrears before paying ahead, always.
 *   3. Records EACH day it settled in payment_allocations, so the member and
 *      the admin can see exactly what the money covered.
 *   4. Any remainder the member does not owe becomes credit_balance, applied
 *      automatically next time.
 *
 * `amount` is the contribution value the member is saving, not the grossed-up
 * charge — the service charge is the operator's fee, never savings.
 */

export interface Allocation {
  contribution_id: string
  group_name: string
  amount: number
  kind: 'full' | 'part'
  due_date: string
}
export interface SettleResult {
  daysCleared: number
  allocations: Allocation[]
  creditAdded: number      // left over, banked to the member's credit
  creditUsed: number       // pre-existing credit consumed
  groups: string[]         // distinct group names touched
}

export async function settlePayment(
  startContributionId: string,
  amount: number,
  reference: string,
  scope: 'member' | 'slot' = 'member',
): Promise<SettleResult> {
  const now = new Date().toISOString()

  const { data: start } = await supabaseAdmin
    .from('contributions')
    .select('id, amount, amount_paid, penalty_due, membership_id, member_id, due_date, status, group_id')
    .eq('id', startContributionId).single()

  const empty: SettleResult = { daysCleared: 0, allocations: [], creditAdded: 0, creditUsed: 0, groups: [] }
  if (!start) return empty

  // Fold in any credit the member is already carrying
  let creditUsed = 0
  if (start.member_id) {
    const { data: m } = await supabaseAdmin
      .from('members').select('credit_balance').eq('id', start.member_id).single()
    creditUsed = Number(m?.credit_balance ?? 0)
  }
  let left = Math.round((amount + creditUsed) * 100) / 100

  // Build the queue of days this money may cover
  const cols = 'id, amount, amount_paid, penalty_due, membership_id, member_id, due_date, status, group_id, susu_groups(name)'
  let queue: any[] = []
  {
    const { data: s0 } = await supabaseAdmin.from('contributions').select(cols).eq('id', startContributionId).single()
    if (s0) queue.push(s0)
  }
  if (start.membership_id) {
    const { data: sameSlot } = await supabaseAdmin.from('contributions').select(cols)
      .eq('membership_id', start.membership_id).in('status', ['pending', 'overdue'])
      .neq('id', startContributionId).order('due_date', { ascending: true }).limit(300)
    queue = queue.concat(sameSlot ?? [])
  }
  if (scope === 'member' && start.member_id) {
    const { data: other } = await supabaseAdmin.from('contributions').select(cols)
      .eq('member_id', start.member_id).in('status', ['pending', 'overdue'])
      .neq('membership_id', start.membership_id ?? '').order('due_date', { ascending: true }).limit(600)
    queue = queue.concat(other ?? [])
  }

  const allocations: Allocation[] = []
  const groups = new Set<string>()
  let daysCleared = 0

  for (const c of queue) {
    if (left <= 0.001) break
    if (c.status === 'paid') continue
    const owed = Number(c.amount) + Number(c.penalty_due ?? 0) - Number(c.amount_paid ?? 0)
    if (owed <= 0.001) continue
    const groupName = (c.susu_groups as { name?: string } | null)?.name ?? 'Susu'

    if (left + 0.001 >= owed) {
      await supabaseAdmin.from('contributions')
        .update({ status: 'paid', paid_at: now, paystack_ref: reference, amount_paid: Number(c.amount) })
        .eq('id', c.id)
      await supabaseAdmin.from('payment_penalties')
        .update({ is_paid: true, paid_at: now }).eq('contribution_id', c.id).then(() => {}, () => {})
      allocations.push({ contribution_id: c.id, group_name: groupName, amount: Math.round(owed * 100) / 100, kind: 'full', due_date: c.due_date })
      groups.add(groupName)
      left = Math.round((left - owed) * 100) / 100
      daysCleared++
    } else {
      await supabaseAdmin.from('contributions')
        .update({ amount_paid: Math.round((Number(c.amount_paid ?? 0) + left) * 100) / 100 })
        .eq('id', c.id)
      allocations.push({ contribution_id: c.id, group_name: groupName, amount: Math.round(left * 100) / 100, kind: 'part', due_date: c.due_date })
      groups.add(groupName)
      left = 0
    }
  }

  // Persist the allocation breakdown
  if (allocations.length && start.member_id) {
    await supabaseAdmin.from('payment_allocations').insert(
      allocations.map(a => ({
        reference, member_id: start.member_id, contribution_id: a.contribution_id,
        group_name: a.group_name, amount: a.amount, kind: a.kind,
      }))).then(() => {}, () => {})
  }

  // Reconcile the member's credit: consumed what they had, bank any remainder
  if (start.member_id) {
    const newCredit = Math.round(left * 100) / 100
    if (newCredit !== creditUsed) {
      await supabaseAdmin.from('members')
        .update({ credit_balance: newCredit }).eq('id', start.member_id).then(() => {}, () => {})
    }
  }

  return {
    daysCleared,
    allocations,
    creditAdded: Math.round(left * 100) / 100,
    creditUsed,
    groups: [...groups],
  }
}

/** Back-compat alias — older callers import applyPaymentToSchedule. */
export const applyPaymentToSchedule = settlePayment

/*
 * Claim a transaction so exactly one settlement path wins.
 *
 * The callback, the app polling and the sweeper can fire for the same payment
 * at the same moment; each used to flip the row and send its own receipt, so
 * members got told twice and thought they were charged twice. The update is
 * conditional on the row still being pending — the first caller wins, the rest
 * stop without messaging.
 */
export async function claimTransaction(txId: string, extra: Record<string, unknown> = {}): Promise<boolean> {
  const { data: current } = await supabaseAdmin
    .from('transactions').select('paystack_data').eq('id', txId).single()
  const { data, error } = await supabaseAdmin
    .from('transactions')
    .update({ status: 'success', paystack_data: { ...((current?.paystack_data as Record<string, unknown>) ?? {}), ...extra } as never })
    .eq('id', txId).eq('status', 'pending').select('id')
  if (error) { console.error('claim failed', error.message); return false }
  return (data ?? []).length > 0
}
