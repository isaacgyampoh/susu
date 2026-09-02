/**
 * CAN SOMEBODY JOIN THIS GROUP, AND IF NOT, WHY NOT?
 *
 * ────────────────────────────────────────────────────────────────────────
 * There are two doors into a group — a member applying through the public
 * form, and an administrator adding somebody directly — and they used to
 * disagree about what a refusal means.
 *
 * The public door said, for a group that had stopped accepting applications:
 *
 *     "cannot take 1 slot — only 19 left"
 *
 * Two true-sounding numbers that contradict each other, and no way for the
 * applicant to act on either. Nineteen slots WERE free; the group was simply
 * closed. Capacity was being reported for a refusal that had nothing to do
 * with capacity.
 *
 * The admin door had the opposite bug: it read `status` and never looked at
 * it, so a completed group would silently accept a new member.
 *
 * Both now ask this function, which answers in one order: WHAT KIND of refusal
 * is this — the group's state, or its capacity — and only then how many slots
 * are involved. A reason is only ever about the thing that actually blocked it.
 * ────────────────────────────────────────────────────────────────────────
 *
 * This module is pure and imports nothing, so the same file that both edge
 * functions run is the file the test suite exercises. There is no second copy
 * to drift.
 */

export type GroupState = {
  name: string
  /** 'open' | 'full' | 'active' | 'completed' | 'closed' | anything else */
  status: string | null
  max_members: number | null
  current_members: number | null
}

/** Which doors accept which states. */
export const PUBLIC_JOINABLE = ['open', 'full'] as const
export const ADMIN_JOINABLE  = ['open', 'full', 'active'] as const

/** Why a given status refuses, in words an applicant or admin can act on. */
function reasonForStatus(name: string, status: string | null): string {
  switch (status) {
    case 'active':
      return `"${name}" has already started, so it is not taking new applications.`
    case 'completed':
      return `"${name}" has finished and paid out.`
    case 'closed':
      return `"${name}" is closed.`
    default:
      return `"${name}" is not accepting applications at the moment.`
  }
}

/**
 * @returns null when the join is allowed, otherwise the reason to show.
 */
export function refuseJoin(
  group: GroupState,
  wantSlots: number,
  allowed: readonly string[],
): string | null {
  const name = group.name ?? 'This group'

  // STATE FIRST. A closed group is closed whether it has nineteen free slots
  // or none, and saying anything about capacity here is what produced the
  // contradictory message.
  if (!allowed.includes(group.status ?? '')) {
    return reasonForStatus(name, group.status)
  }

  const max  = Number(group.max_members ?? 0)
  const used = Number(group.current_members ?? 0)
  const free = Math.max(0, max - used)

  if (free <= 0)      return `"${name}" is full.`
  if (wantSlots > free) {
    return `"${name}" has ${free} slot${free === 1 ? '' : 's'} left, and you asked for ${wantSlots}.`
  }
  return null
}
