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

  /*
   * ── WHICH TURN DOES THIS SLOT JOIN? ─────────────────────────────────────
   * The database decides, in `join_payout_unit`. A half joins a waiting half
   * and the two collect together — one date, one number — because they are two
   * shares of one turn. A full slot takes a turn of its own.
   *
   * This used to take the lowest free `payout_position`, without ever looking
   * at the fraction. That is what put two halves one cycle apart: a turn and a
   * membership were treated as the same thing, so half a slot consumed a whole
   * turn and got its own date.
   *
   * The five-attempt retry loop that used to live here is gone with it. It
   * existed to survive UNIQUE(group_id, payout_position) collisions between
   * concurrent joins. v55 moved that uniqueness onto the turn, and v56 does the
   * placement and the insert in one statement under one lock, so there is no
   * longer a window between choosing a turn and taking it.
   */
  const quarters = fraction === 1 ? 4 : fraction === 0.5 ? 2 : 1

  const positions: number[] = []
  const membershipIds: string[] = []

  for (let i = 0; i < slots; i++) {
    const { data, error: joinErr } = await supabaseAdmin.rpc('join_payout_unit', {
      p_member_id:     memberId,
      p_group_id:      group.id,
      p_quarters:      quarters,
      p_fraction:      fraction,
      p_portion_id:    portion.id,
      p_payout_amount: portion.payout_amount,
    })

    const placed = data as { membership_id: string; position: number } | null
    // A partial join is recoverable and reported; an unreported one is not.
    if (joinErr || !placed) break

    positions.push(placed.position)
    membershipIds.push(placed.membership_id)

    // The schedule is what makes a membership real. Without it the member owes
    // nothing and the group is short a payer, silently.
    await supabaseAdmin.rpc('generate_membership_schedule', {
      p_membership_id: placed.membership_id,
    })
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
