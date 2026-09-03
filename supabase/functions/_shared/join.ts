import { supabaseAdmin } from './supabase-admin.ts'
import { resolvePortion, type Portion } from './portions.ts'

/**
 * PUTTING A MEMBER INTO A GROUP.
 *
 * ────────────────────────────────────────────────────────────────────────
 * There are two ways somebody ends up in a group now — they join directly, or
 * an administrator approves the application they made — and both have to
 * produce exactly the same thing: memberships at the configured portion, a
 * contribution schedule, and a registration fee if the portion carries one.
 *
 * So there is one function. Writing the approval path separately is how the
 * fraction multiplication ended up copied into five files, and this is the
 * same shape of mistake waiting to happen with something more consequential
 * than an amount: a member approved into a group with no schedule, or charged
 * a fee the direct path would not have charged.
 */

export interface JoinResult {
  positions: number[]
  membershipIds: string[]
  portion: Portion
  registrationFee: number
}

export interface JoinableGroup {
  id: string
  name: string
  status: string
  max_members: number
  current_members: number
  contribution_amount?: number | null
  cashout_amount?: number | null
  registration_fee?: number | null
}

/** Why a join cannot proceed, in words the caller can show. Null means go. */
export function refuseCapacity(group: JoinableGroup, slots: number): string | null {
  if (!['open', 'full', 'active'].includes(group.status)) {
    return `"${group.name}" is not accepting members.`
  }
  const free = Math.max(0, (group.max_members ?? 0) - (group.current_members ?? 0))
  if (free <= 0)    return `"${group.name}" is full.`
  if (slots > free) return `"${group.name}" has ${free} slot${free === 1 ? '' : 's'} left, and ${slots} were asked for.`
  return null
}

/**
 * Create the memberships, their schedules and the fee.
 *
 * `feeStatus` is the one thing the two callers differ on, and deliberately so:
 * a member joining from the portal has not paid yet, so the fee is recorded
 * pending. An administrator approving may be recording somebody who already
 * handed over cash — but that is their decision to state, not one this function
 * should assume, so the default matches the portal.
 */
export async function createMemberships(opts: {
  memberId: string
  group: JoinableGroup
  slots: number
  fraction: number
  feeStatus?: 'pending' | 'success'
  describedAs?: string
}): Promise<JoinResult> {
  const { memberId, group, slots, fraction } = opts
  const portion = await resolvePortion(group.id, fraction, group)

  // Positions already taken, so two slots in one call do not collide.
  const { data: taken } = await supabaseAdmin
    .from('group_memberships').select('payout_position').eq('group_id', group.id)
  const used = new Set((taken ?? []).map((r: { payout_position: number }) => r.payout_position))

  const positions: number[] = []
  const membershipIds: string[] = []

  for (let i = 0; i < slots; i++) {
    let position = 1
    while (used.has(position)) position++
    used.add(position)

    const { data: gm, error: gmErr } = await supabaseAdmin
      .from('group_memberships')
      .insert({
        member_id: memberId, group_id: group.id,
        payout_position: position, status: 'active',
        payout_amount: portion.payout_amount,
        slot_fraction: fraction,
        portion_id: portion.id,
      })
      .select('id').single()

    // Stop rather than press on: a partial join is recoverable, an unreported
    // one is not.
    if (gmErr || !gm) break

    positions.push(position)
    membershipIds.push(gm.id)

    // The schedule is what makes a membership real. Without it the member owes
    // nothing and the group is short a payer, silently.
    await supabaseAdmin.rpc('generate_membership_schedule', { p_membership_id: gm.id })
  }

  const registrationFee = Math.round(portion.registration_fee * positions.length * 100) / 100

  if (registrationFee > 0 && positions.length > 0) {
    await supabaseAdmin.from('transactions').insert({
      member_id: memberId,
      type: 'registration_fee',
      amount: registrationFee,
      reference: `REG-${memberId.slice(0, 8)}-${group.id.slice(0, 8)}-${Date.now()}`,
      description: opts.describedAs
        ?? `Registration fee for "${group.name}"${positions.length > 1 ? ` × ${positions.length} slots` : ''}`,
      status: opts.feeStatus ?? 'pending',
    })
  }

  return { positions, membershipIds, portion, registrationFee }
}
