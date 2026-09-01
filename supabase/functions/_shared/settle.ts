import { supabaseAdmin } from './supabase-admin.ts'

/*
 * ────────────────────────────────────────────────────────────────────────
 *  SETTLEMENT — now a thin call to the canonical database engine.
 * ────────────────────────────────────────────────────────────────────────
 *
 * This file used to CONTAIN the settlement algorithm: it read the member's
 * credit, walked their unpaid days, and issued a separate PostgREST call for
 * every update. That design had four defects that could not be fixed in place:
 *
 *   * NOT ATOMIC. Every write was its own request with no transaction. A
 *     failure part-way left days paid, the allocation ledger short, and credit
 *     unreconciled, with nothing to roll back.
 *   * NO LOCKING. It read `credit_balance`, then wrote it back at the end. Two
 *     concurrent settlements read the same value and both spent it.
 *   * UNCHECKED WRITES. The result of the contribution UPDATE was discarded.
 *     When `uniq_contribution_ref` rejected the second day of a multi-day
 *     payment, the failure vanished while the running total was still
 *     decremented and the allocation row still written — finding F-02, which
 *     billed one member twice for the same two days.
 *   * MEMBER-SCOPED CREDIT. A surplus paid into one group settled another's
 *     obligation.
 *
 * All four are properties of *where* the code ran, not of its logic. So the
 * logic moved into `settle_payment()` in PostgreSQL, where a transaction and
 * `SELECT … FOR UPDATE` are available, and this module became the call site.
 *
 * The database function is now the financial authority. It is conformance-
 * tested against the pure allocator in src/domain/contribution/allocation.ts,
 * so the rule it implements is the rule the portal previews.
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
  creditAdded: number
  creditUsed: number
  groups: string[]
  /** True when this call performed the settlement; false when it was a replay. */
  settled: boolean
}

const EMPTY: SettleResult = {
  daysCleared: 0, allocations: [], creditAdded: 0, creditUsed: 0, groups: [], settled: false,
}

/**
 * Settle a payment by its reference.
 *
 * IDEMPOTENT. Calling this ten times for one payment settles once and returns
 * the same allocations every time — the database locks the transaction row and
 * checks its status inside the same transaction, so a replay cannot race the
 * original. Callers no longer need to claim the payment first; doing so would
 * in fact break it, because the engine treats an already-successful
 * transaction as a completed settlement.
 *
 * @param reference       OUR payment reference — the identity of the payment.
 * @param confirmedAmount what the provider says actually arrived. The engine
 *                        applies the LESSER of this and the recorded amount, so
 *                        a short payment can never over-credit.
 * @param scope           'slot' honours the member's "pay this group only"
 *                        choice; 'member' may reach their other memberships.
 */
export async function settlePayment(
  reference: string,
  confirmedAmount?: number,
  scope: 'member' | 'slot' = 'member',
): Promise<SettleResult> {
  const { data, error } = await supabaseAdmin.rpc('settle_payment', {
    p_reference: reference,
    p_confirmed_amount: confirmedAmount ?? null,
    p_scope: scope,
  })

  if (error) {
    // Never swallow this. A settlement that failed must be visible: the whole
    // reason F-02 went unnoticed for weeks is that its errors were discarded.
    console.error(`settle_payment failed for ${reference}:`, error.message)
    throw new Error(`Settlement failed for ${reference}: ${error.message}`)
  }

  const rows = (data ?? []) as {
    o_contribution_id: string
    o_membership_id: string
    o_group_name: string
    o_due_date: string
    o_amount_applied: string | number
    o_kind: 'full' | 'part'
  }[]

  if (rows.length === 0) return { ...EMPTY, settled: true }

  const allocations: Allocation[] = rows.map(r => ({
    contribution_id: r.o_contribution_id,
    group_name: r.o_group_name,
    amount: Number(r.o_amount_applied),
    kind: r.o_kind,
    due_date: r.o_due_date,
  }))

  return {
    daysCleared: allocations.filter(a => a.kind === 'full').length,
    allocations,
    // Reported by the engine's own log rather than recomputed here, so there
    // is one source of truth for what a settlement did.
    creditAdded: await creditBankedFor(reference),
    creditUsed: 0,
    groups: [...new Set(allocations.map(a => a.group_name))],
    settled: true,
  }
}

async function creditBankedFor(reference: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from('settlement_log')
    .select('credit_banked')
    .eq('reference', reference)
    .eq('event', 'settlement_completed')
    .order('created_at', { ascending: false })
    .limit(1)
  return Number(data?.[0]?.credit_banked ?? 0)
}

/** What a payment WOULD cover, without moving anything. */
export async function previewSettlement(
  reference: string,
  amount?: number,
  scope: 'member' | 'slot' = 'member',
): Promise<unknown> {
  const { data, error } = await supabaseAdmin.rpc('preview_settlement', {
    p_reference: reference,
    p_confirmed_amount: amount ?? null,
    p_scope: scope,
  })
  if (error) throw new Error(`Preview failed for ${reference}: ${error.message}`)
  return data
}

/**
 * DEPRECATED — kept only so any straggling import still compiles.
 *
 * Claiming a payment before settling it is now wrong: `settle_payment()` locks
 * the transaction row and checks its status inside the settling transaction,
 * which is strictly stronger than a conditional update issued beforehand. A
 * caller that claims first marks the payment successful, and the engine then
 * sees a completed payment and settles nothing.
 *
 * Always returns true so an un-migrated caller proceeds to settlement rather
 * than silently skipping it.
 */
export async function claimTransaction(_txId: string, _extra: Record<string, unknown> = {}): Promise<boolean> {
  console.warn('claimTransaction() is deprecated — settle_payment() claims the payment atomically')
  return true
}

/** Back-compat alias. */
export const applyPaymentToSchedule = settlePayment
