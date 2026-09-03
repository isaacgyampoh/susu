import { supabaseAdmin } from './supabase-admin.ts'

/**
 * WHAT A PORTION OF A GROUP COSTS AND PAYS.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Every join path used to work this out by multiplying:
 *
 *     contribution = group.contribution_amount * fraction
 *     payout       = group.cashout_amount      * fraction
 *     registration = group.registration_fee    * fraction
 *
 * which forced a half slot to pay exactly half and collect exactly half. The
 * amounts are configured per group now, in `group_portions`, so a half portion
 * can pay GHS 500 and collect GHS 950 if that is what the susu actually runs.
 *
 * This is the one place that resolves them, so the four join paths cannot
 * drift apart — which is how the multiplication ended up written out five
 * separate times in the first place.
 *
 * ── THE FALLBACK IS DELIBERATE ──────────────────────────────────────────
 *
 * A group created before this table exists, or one an administrator has not
 * configured, still has to be joinable. So a missing portion falls back to the
 * old multiplication rather than refusing or inventing a number. Because the
 * backfill wrote exactly what that multiplication produced, the two agree
 * everywhere today; they diverge only where somebody has deliberately set a
 * different figure.
 */

export interface Portion {
  id: string | null
  label: string
  fraction: number
  contribution_amount: number
  payout_amount: number
  registration_fee: number
}

export interface GroupMoney {
  contribution_amount?: number | null
  cashout_amount?: number | null
  registration_fee?: number | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Resolve the portion a member is taking. Never throws; never returns null. */
export async function resolvePortion(
  groupId: string,
  fraction: number,
  group: GroupMoney,
): Promise<Portion> {
  const { data } = await supabaseAdmin
    .from('group_portions')
    .select('id, label, fraction, contribution_amount, payout_amount, registration_fee')
    .eq('group_id', groupId)
    .eq('fraction', fraction)
    .eq('is_active', true)
    .maybeSingle()

  if (data) {
    return {
      id: data.id,
      label: data.label,
      fraction: Number(data.fraction),
      contribution_amount: Number(data.contribution_amount),
      payout_amount: Number(data.payout_amount),
      registration_fee: Number(data.registration_fee),
    }
  }

  // Unconfigured group: the old behaviour, so joining never breaks.
  return {
    id: null,
    label: fraction === 1 ? 'Full' : fraction === 0.5 ? 'Half' : fraction === 0.25 ? 'Quarter' : `${fraction}`,
    fraction,
    contribution_amount: round2(Number(group.contribution_amount ?? 0) * fraction),
    payout_amount:       round2(Number(group.cashout_amount ?? 0) * fraction),
    registration_fee:    round2(Number(group.registration_fee ?? 0) * fraction),
  }
}

/** Every portion a group offers, for the member's "what can I take" list. */
export async function listPortions(groupId: string, group: GroupMoney): Promise<Portion[]> {
  const { data } = await supabaseAdmin
    .from('group_portions')
    .select('id, label, fraction, contribution_amount, payout_amount, registration_fee')
    .eq('group_id', groupId).eq('is_active', true)
    .order('sort_order')

  if (data && data.length > 0) {
    return data.map(p => ({
      id: p.id, label: p.label, fraction: Number(p.fraction),
      contribution_amount: Number(p.contribution_amount),
      payout_amount: Number(p.payout_amount),
      registration_fee: Number(p.registration_fee),
    }))
  }
  return [1, 0.5, 0.25].map(f => ({
    id: null,
    label: f === 1 ? 'Full' : f === 0.5 ? 'Half' : 'Quarter',
    fraction: f,
    contribution_amount: round2(Number(group.contribution_amount ?? 0) * f),
    payout_amount:       round2(Number(group.cashout_amount ?? 0) * f),
    registration_fee:    round2(Number(group.registration_fee ?? 0) * f),
  }))
}
