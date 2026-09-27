import { supabaseAdmin } from './supabase-admin.ts'
import { sendSMS, smsTemplates } from './africas-talking.ts'

/**
 * TELLING A CUSTOMER THEIR MONEY LANDED.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Shared by both settlement doors — payments-verify, when the phone asks, and
 * nalo-webhook, when NaloPay says so independently. Putting it in one place is
 * what stops the two paths sending differently worded messages, or one of them
 * forgetting to send at all.
 *
 * ── IT NEVER SENDS TWICE FOR ONE PAYMENT ────────────────────────────────
 *
 * Both doors race for the same payment and the loser gets `duplicate: true`
 * from the settlement function. This only speaks when something actually
 * moved. Without that check a customer gets two texts for one payment, which
 * reads like being charged twice.
 *
 * ── AND IT NEVER FAILS A SETTLEMENT ─────────────────────────────────────
 *
 * Every path returns rather than throws. The money is recorded and correct
 * whether or not the SMS goes; a texting failure that rolled back a settlement
 * would be a far worse bug than a missing text.
 */
export async function notifyPurchasePayment(
  purchaseId: string,
  result: { duplicate?: boolean; applied?: number; balance?: number; fully_paid?: boolean } | null,
): Promise<void> {
  try {
    if (!result || result.duplicate) return
    if (!result.applied || result.applied <= 0.004) return

    const { data } = await supabaseAdmin
      .from('purchases')
      .select('product_name, members!member_id(full_name, phone)')
      .eq('id', purchaseId).single()
    if (!data) return

    const row = data as unknown as {
      product_name: string
      members: { full_name: string; phone: string } | null
    }
    const phone = row.members?.phone
    if (!phone) return

    const first = (row.members?.full_name ?? '').split(' ')[0] || 'there'

    // Completion is the message that matters; the running balance is noise
    // once there is nothing left to pay.
    const text = result.fully_paid
      ? smsTemplates.purchaseComplete(first, row.product_name)
      : smsTemplates.installmentReceived(
          first,
          Number(result.applied).toFixed(2),
          row.product_name,
          Number(result.balance ?? 0).toFixed(2),
        )

    await sendSMS(phone, text)
  } catch (e) {
    console.error('purchase SMS failed (non-fatal):', (e as Error).message)
  }
}
