import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
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

    for (const { group_id: gid, slots, fraction } of selections) {
      const { data: group } = await supabaseAdmin
        .from('susu_groups')
        .select('id, name, status, max_members, current_members, registration_fee, cashout_amount')
        .eq('id', gid).single()

      if (!group) { failed.push({ group_id: gid, reason: 'Group not found' }); continue }
      if (!['open', 'full', 'active'].includes(group.status)) {
        failed.push({ group: group.name, reason: 'No longer accepting members' }); continue
      }
      if (group.current_members + slots > group.max_members) {
        failed.push({ group: group.name, reason: `Only ${group.max_members - group.current_members} slot(s) left` }); continue
      }

      // A member already in the group is simply taking MORE slots — allowed.
      const { data: taken } = await supabaseAdmin
        .from('group_memberships').select('payout_position')
        .eq('group_id', gid)
      const used = new Set((taken ?? []).map((r: any) => r.payout_position))

      const positions: number[] = []
      let ok = true
      for (let i = 0; i < slots; i++) {
        let position = 1
        while (used.has(position)) position++
        used.add(position)

        const gmRow: Record<string, unknown> = {
          member_id: memberId, group_id: gid,
          payout_position: position, status: 'active',
          payout_amount: Math.round(Number(group.cashout_amount ?? 0) * fraction * 100) / 100,
          slot_fraction: fraction,
        }
        let { error: gmErr } = await supabaseAdmin.from('group_memberships').insert(gmRow)
        if (gmErr && /slot_fraction/.test(gmErr.message)) {
          delete gmRow.slot_fraction
          ;({ error: gmErr } = await supabaseAdmin.from('group_memberships').insert(gmRow))
        }
        if (gmErr) { failed.push({ group: group.name, reason: gmErr.message }); ok = false; break }
        positions.push(position)
      }
      if (!ok && positions.length === 0) continue

      if (Number(group.registration_fee) > 0 && positions.length > 0) {
        await supabaseAdmin.from('transactions').insert({
          member_id: memberId, type: 'registration_fee',
          amount: Math.round(group.registration_fee * positions.length * fraction * 100) / 100,
          reference: `REG-${memberId.slice(0, 8)}-${gid.slice(0, 8)}-${Date.now()}`,
          description: `Registration fee for "${group.name}"${positions.length > 1 ? ` × ${positions.length} slots` : ''} (member joined from portal — awaiting payment)`,
          status: 'pending',
        })
      }

      joined.push({
        group: group.name,
        slots: positions.length,
        fraction,
        payout_positions: positions,
        payout_position: positions[0],
        registration_fee: Number(group.registration_fee || 0) * positions.length,
        cashout_amount:   Number(group.cashout_amount || 0),
      })
    }

    if (joined.length === 0) {
      return error(failed[0]?.reason ?? 'Could not join the selected groups', 400)
    }

    return json({
      message: `Joined ${joined.length} group${joined.length > 1 ? 's' : ''}`,
      joined, failed,
    }, 201)
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
