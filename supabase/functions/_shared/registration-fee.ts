import { supabaseAdmin } from './supabase-admin.ts'

/**
 * Settling a REGISTRATION FEE.
 *
 * ────────────────────────────────────────────────────────────────────────
 * A registration fee is not a contribution. It buys a place in a group; it
 * does not discharge a daily obligation, and it must never be allocated to
 * one. `settle_payment()` anchors a payment to an obligation via
 * `transactions.related_id`, and every registration_fee row in production has
 * `related_id = NULL` — routing one through the settlement engine raises.
 *
 * The three settlement callers therefore branch on `transactions.type` and
 * send registration fees here instead.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PHASE 07: this module used to BE the settlement. It issued three separate
 * PostgREST writes — claim the transaction, mark the application paid, write
 * the log — with no transaction around them. That is the same defect Phase 04
 * removed from contributions: a crash between the first and second write
 * leaves money recorded as received against an application still marked
 * unpaid, and nothing to roll back.
 *
 * It also computed `least(confirmed, recorded)` and then marked the
 * application paid with whatever that produced, so a provider reporting
 * GHS 100 against a GHS 150 fee unlocked registration in full for two thirds
 * of the money.
 *
 * Both are now the database's problem, in `settle_registration_fee()`: one
 * transaction, one row lock, and a short payment settles NOTHING.
 */

export interface RegistrationSettlement {
  /** True when the fee is now recorded as fully received. */
  settled: boolean
  /** True when a previous call had already settled it — a replay. */
  alreadyDone: boolean
  /** True when the provider confirmed LESS than the fee. Nothing was settled. */
  short: boolean
  /** What was recorded as registration income (never more than the fee). */
  amount: number
  /** The authoritative fee, computed by the server from susu_groups. */
  expected: number
  kycId: string | null
  memberId: string | null
}

/**
 * IDEMPOTENT. Ten callbacks for one payment settle once and return the same
 * answer every time — the database locks the transaction row and checks its
 * status inside the settling transaction, so a replay cannot race the original.
 *
 * @param reference       OUR payment reference — the identity of the payment.
 * @param confirmedAmount what the PROVIDER says actually arrived. Callers must
 *                        have this from the provider's own status endpoint; a
 *                        client's claim about it is not evidence.
 */
export async function settleRegistrationFee(
  reference: string,
  confirmedAmount?: number,
): Promise<RegistrationSettlement> {
  const { data, error } = await supabaseAdmin.rpc('settle_registration_fee', {
    p_reference: reference,
    p_confirmed_amount: confirmedAmount ?? null,
  })

  if (error) {
    // Never swallow this. A settlement that failed must stay visible — the
    // reason F-02 ran undetected for weeks is that its errors were discarded.
    console.error(`settle_registration_fee failed for ${reference}:`, error.message)
    throw new Error(`Registration settlement failed for ${reference}: ${error.message}`)
  }

  const row = ((data ?? []) as Record<string, unknown>[])[0]
  if (!row) throw new Error(`Registration settlement returned nothing for ${reference}`)

  return {
    settled:     Boolean(row.o_settled),
    alreadyDone: Boolean(row.o_already),
    short:       Boolean(row.o_short),
    amount:      Number(row.o_applied  ?? 0),
    expected:    Number(row.o_expected ?? 0),
    kycId:       (row.o_kyc_id as string | null) ?? null,
    memberId:    (row.o_member_id as string | null) ?? null,
  }
}
