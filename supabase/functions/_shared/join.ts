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

    /*
     * ── A CONCURRENT JOIN CAN TAKE THIS POSITION FIRST ──────────────────
     * `used` was read before the loop. Between that read and this insert,
     * somebody else joining the same group can take the position we picked, and
     * UNIQUE(group_id, payout_position) rejects ours.
     *
     * The first version of this shared function simply gave up on that error,
     * which made it LESS robust than the kyc-review path it was extracted to
     * unify — two members joining a popular group at the same moment, and one
     * is told "could not take a slot" when the next position was free.
     *
     * So it re-reads the live positions and tries again. Five attempts, then a
     * clean stop: a partial join is recoverable and reported, an unreported one
     * is not.
     */
    let gm: { id: string } | null = null
    let placed = position

    for (let attempt = 0; attempt < 5 && !gm; attempt++) {
      const { data, error: gmErr } = await supabaseAdmin
        .from('group_memberships')
        .insert({
          member_id: memberId, group_id: group.id,
          payout_position: placed, status: 'active',
          payout_amount: portion.payout_amount,
          slot_fraction: fraction,
          portion_id: portion.id,
        })
        .select('id').single()

      if (data) { gm = data; break }

      const clash = gmErr?.code === '23505' || /payout_position/.test(gmErr?.message ?? '')
      if (!clash) break                       // a real failure, not a race

      const { data: retaken } = await supabaseAdmin
        .from('group_memberships').select('payout_position').eq('group_id', group.id)
      const takenNow = new Set((retaken ?? []).map((r: { payout_position: number }) => r.payout_position))
      let p = 1
      while (takenNow.has(p)) p++
      placed = p
      used.add(p)
    }

    if (!gm) break
    position = placed

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
