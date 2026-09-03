import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { resolvePortion } from '../_shared/portions.ts'
import { createMemberships, refuseCapacity } from '../_shared/join.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireMember }           from '../_shared/jwt.ts'

/*
 * A signed-in member joining MORE groups from the portal. They may select
 * several at once ({ group_ids: [...] }); each is validated independently
 * so one full group doesn't sink the whole request.
 *
 * Registration fees are not collected here — if a group has one, a pending
 * 'registration_fee' transaction is recorded so the admin can collect and
 * confirm it, exactly as with admin-recorded fees.
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST') return error('Method not allowed', 405)

  const session = await requireMember(req)
  if (!session) return error('Unauthorized', 401)

  try {
    const memberId = session.sub as string
    const body = await req.json()
    // New shape: selections: [{ group_id, slots }]; legacy: group_ids: [...]
    const FRACS = [0.25, 0.5, 1]
    const selections: { group_id: string; slots: number; fraction: number }[] =
      Array.isArray(body.selections)
        ? body.selections
            .filter((s: any) => s?.group_id)
            .map((s: any) => ({ group_id: s.group_id, slots: Math.max(1, Math.min(10, Number(s.slots ?? 1))), fraction: FRACS.includes(Number(s.fraction)) ? Number(s.fraction) : 1 }))
        : [...new Set(((Array.isArray(body.group_ids) ? body.group_ids : []) as string[]).filter(Boolean))]
            .map(id => ({ group_id: id, slots: 1, fraction: 1 }))
    if (selections.length === 0) return error('Select at least one group to join')

    const { data: member } = await supabaseAdmin
      .from('members').select('id, full_name, status').eq('id', memberId).single()
    if (!member) return error('Member not found', 404)
    if (member.status !== 'active') return error('Your account is not active. Contact the administrator.', 403)

    const joined: any[] = []
    const failed: any[] = []

    const applied: any[] = []

    for (const { group_id: gid, slots, fraction } of selections) {
      const { data: group } = await supabaseAdmin
        .from('susu_groups')
        .select('id, name, status, max_members, current_members, registration_fee, cashout_amount, contribution_amount, requires_approval')
        .eq('id', gid).single()

      if (!group) { failed.push({ group_id: gid, reason: 'Group not found' }); continue }

      const refusal = refuseCapacity(group, slots)
      if (refusal) { failed.push({ group: group.name, reason: refusal }); continue }

      /*
       * ── APPLY, OR JOIN ────────────────────────────────────────────────
       * A group whose collector vets who comes in takes an APPLICATION: no
       * membership, no schedule, no fee, nothing owed. Everything else joins
       * immediately, exactly as before — `requires_approval` defaults to false,
       * so no existing group changes behaviour.
       */
      if (group.requires_approval) {
        const portion = await resolvePortion(gid, fraction, group)

        const { error: aErr } = await supabaseAdmin.from('group_applications').insert({
          group_id: gid, member_id: memberId,
          portion_id: portion.id, slot_fraction: fraction, slots,
        })

        if (aErr) {
          // The partial unique index makes a second pending application
          // impossible; say so plainly rather than leaking the constraint.
          failed.push({
            group: group.name,
            reason: aErr.code === '23505'
              ? 'You have already applied to this group. Your collector is reviewing it.'
              : 'Could not send your application. Please try again.',
          })
          continue
        }

        applied.push({ group: group.name, slots, portion: portion.label })
        continue
      }

      const { positions, portion, registrationFee } = await createMemberships({
        memberId, group, slots, fraction,
        describedAs: `Registration fee for "${group.name}"${slots > 1 ? ` × ${slots} slots` : ''} (member joined from portal — awaiting payment)`,
      })

      if (positions.length === 0) {
        failed.push({ group: group.name, reason: 'Could not take a slot in this group' })
        continue
      }

      joined.push({
        group: group.name,
        slots: positions.length,
        fraction,
        payout_positions: positions,
        payout_position: positions[0],
        portion: portion.label,
        registration_fee: registrationFee,
        cashout_amount: portion.payout_amount,
      })
    }

    if (joined.length === 0 && applied.length === 0) {
      return error(failed[0]?.reason ?? 'Could not join the selected groups', 400)
    }

    const parts = []
    if (joined.length)  parts.push(`Joined ${joined.length} group${joined.length > 1 ? 's' : ''}`)
    if (applied.length) parts.push(`Applied to ${applied.length} group${applied.length > 1 ? 's' : ''}`)

    return json({ message: parts.join(' · '), joined, applied, failed }, 201)
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
