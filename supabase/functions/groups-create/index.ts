import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'

/** Fields an admin may change. Anything else is ignored rather than trusted. */
const EDITABLE = [
  'name', 'description', 'contribution_amount', 'contribution_frequency',
  'cycle_days', 'max_members', 'registration_fee', 'cashout_amount',
  'payment_deadline', 'penalty_per_late_day', 'rules', 'admin_notes', 'show_on_website',
]

/** Changing these after a schedule exists would move money or dates. */
const STRUCTURAL = ['contribution_amount', 'contribution_frequency', 'cycle_days', 'max_members']

serveWithCors(async (req) => {
  const c = handleCors(req)
  if (c) return c

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  const url    = new URL(req.url)
  const method = req.method
  const id     = url.searchParams.get('id')

  try {
    // ── CREATE ──
    if (method === 'POST') {
      const b = await req.json()
      if (!b.name || !b.contribution_amount || !b.max_members || !b.cycle_days) {
        return error('name, contribution_amount, max_members and cycle_days are required')
      }
      // The payout is decided, never derived. Without it there is no group.
      if (!b.cashout_amount || Number(b.cashout_amount) <= 0) {
        return error('Set the member cashout amount. It is what members are paid and it is not calculated from the other fields.')
      }

      const { data: group, error: e } = await supabaseAdmin
        .from('susu_groups')
        .insert({
          name: b.name,
          description: b.description,
          contribution_amount:    parseFloat(b.contribution_amount),
          contribution_frequency: b.contribution_frequency ?? 'daily',
          cycle_days:             parseInt(b.cycle_days),
          max_members:            parseInt(b.max_members),
          registration_fee:       parseFloat(b.registration_fee ?? 0),
          cashout_amount:         parseFloat(b.cashout_amount),
          payment_deadline:       b.payment_deadline ?? '18:00:00',
          penalty_per_late_day:   parseFloat(b.penalty_per_late_day ?? 0),
          reg_fee_to_cashout:     false,   // commission is never folded into a payout
          rules: b.rules, admin_notes: b.admin_notes,
          status: 'open', created_by: admin.sub,
        })
        .select().single()

      if (e) return error(e.message, 500)

      await supabaseAdmin.from('audit_log').insert({
        admin_id: admin.sub, admin_name: admin.full_name ?? admin.email,
        action: 'group.created', entity_type: 'group', entity_id: group.id,
        entity_label: group.name, details: { cashout: group.cashout_amount },
      })

      return json({ group }, 201)
    }

    // ── EDIT ──
    if (method === 'PATCH' && id) {
      const body = await req.json()

      const { data: existing } = await supabaseAdmin
        .from('susu_groups').select('*').eq('id', id).single()
      if (!existing) return error('Group not found', 404)

      // Only the fields we allow, and only those actually sent
      const patch: Record<string, unknown> = {}
      for (const k of EDITABLE) if (k in body && body[k] !== undefined) patch[k] = body[k]
      for (const k of ['contribution_amount','cycle_days','max_members','registration_fee','cashout_amount','penalty_per_late_day']) {
        if (k in patch && patch[k] !== null && patch[k] !== '') patch[k] = Number(patch[k])
      }
      // The true start date may be recorded any time before activation;
      // once the group is running, dates change via activate (rebuild).
      if ('start_date' in body && body.start_date !== undefined) {
        if (existing.status === 'active') {
          return error("This group is running — use 'change date' on the Groups page so the schedule is rebuilt correctly.")
        }
        patch.start_date = body.start_date || null
      }

      if (Object.keys(patch).length === 0) return error('Nothing to update')

      if ('cashout_amount' in patch && (!patch.cashout_amount || Number(patch.cashout_amount) <= 0)) {
        return error('The member cashout cannot be empty. It is what members are paid.')
      }

      // Once a schedule exists, structural edits would move real dates and money
      const { count: paidCount } = await supabaseAdmin
        .from('contributions').select('*', { count: 'exact', head: true })
        .eq('group_id', id).eq('status', 'paid')

      if (existing.status === 'active') {
        const touched = STRUCTURAL.filter(k => k in patch && patch[k] !== existing[k])
        if (touched.length && !body.force) {
          return error(
            `This group is running${paidCount ? ` and has ${paidCount} paid contributions` : ''}. ` +
            `Changing ${touched.join(', ')} would move the schedule and members' collection dates. ` +
            `Edit the name, description, rules or notes instead.`, 409)
        }
      }

      // Never shrink a group below the members already in it
      if (patch.max_members && Number(patch.max_members) < existing.current_members) {
        return error(`This group already has ${existing.current_members} members. Max cannot be lower.`, 400)
      }

      const { data: group, error: e } = await supabaseAdmin
        .from('susu_groups').update(patch).eq('id', id).select().single()
      if (e) return error(e.message, 500)

      const changed = Object.keys(patch).filter(k => existing[k] !== group[k])
      await supabaseAdmin.from('audit_log').insert({
        admin_id: admin.sub, admin_name: admin.full_name ?? admin.email,
        action: 'group.updated', entity_type: 'group', entity_id: id,
        entity_label: group.name,
        details: { changed, before: Object.fromEntries(changed.map(k => [k, existing[k]])) },
      })

      return json({ group })
    }

    // ── DELETE ──
    if (method === 'DELETE' && id) {
      const { data: g } = await supabaseAdmin
        .from('susu_groups').select('id, name, status, current_members').eq('id', id).single()
      if (!g) return error('Group not found', 404)

      // Deleting a group with money in it would destroy the record of that money
      const { count: paid } = await supabaseAdmin
        .from('contributions').select('*', { count: 'exact', head: true })
        .eq('group_id', id).eq('status', 'paid')

      if (paid && paid > 0) {
        return error(
          `Cannot delete: ${paid} contribution${paid === 1 ? ' has' : 's have'} been paid into this group. ` +
          `Deleting it would erase that financial record. Mark it completed instead.`, 409)
      }
      const { count: paidOut } = await supabaseAdmin
        .from('payouts').select('*', { count: 'exact', head: true })
        .eq('group_id', id).eq('status', 'paid')
      if (paidOut && paidOut > 0) {
        return error(`Cannot delete: ${paidOut} payout${paidOut === 1 ? ' has' : 's have'} been paid from this group. Mark it completed instead.`, 409)
      }

      // No money has moved — active or not, members or not, it may go.
      // Unwind children in FK order; applications survive, detached.
      await supabaseAdmin.from('payment_penalties').delete().eq('group_id', id)
      await supabaseAdmin.from('contributions').delete().eq('group_id', id)
      await supabaseAdmin.from('payouts').delete().eq('group_id', id)
      const { error: kycErr } = await supabaseAdmin.from('kyc_applications')
        .update({ selected_group_id: null }).eq('selected_group_id', id)
      if (kycErr && !/selected_group_id/.test(kycErr.message)) return error(kycErr.message, 500)
      if (kycErr) {
        return error('Applications reference this group and the database is behind (run migration v19), so it cannot be deleted yet.', 409)
      }
      await supabaseAdmin.from('group_memberships').delete().eq('group_id', id)
      const { error: e } = await supabaseAdmin.from('susu_groups').delete().eq('id', id)
      if (e) return error(e.message, 500)

      await supabaseAdmin.from('audit_log').insert({
        admin_id: admin.sub, admin_name: admin.full_name ?? admin.email,
        action: 'group.deleted', entity_type: 'group', entity_id: id, entity_label: g.name,
      })

      return json({ message: `“${g.name}” deleted` })
    }

    // ── LIST ──
    if (method === 'GET') {
      if (id) {
        const { data: group, error: gErr } = await supabaseAdmin
          .from('susu_groups').select('*').eq('id', id).single()
        if (gErr) return error(gErr.message, 500)

        // The roster: every slot, with the person holding it
        const { data: roster, error: rErr } = await supabaseAdmin
          .from('group_memberships')
          .select('id, payout_position, payout_date, payout_amount, payout_received, status, joined_at, members!member_id(id, member_id, full_name, phone)')
          .eq('group_id', id)
          .order('payout_position', { ascending: true })
        if (rErr) return error(rErr.message, 500)

        // Cross-tracking: which OTHER groups each of these members is in
        const memberIds = [...new Set((roster ?? []).map((r: any) => r.members?.id).filter(Boolean))]
        let otherByMember: Record<string, { id: string; name: string; slots: number }[]> = {}
        if (memberIds.length > 0) {
          const { data: others } = await supabaseAdmin
            .from('group_memberships')
            .select('member_id, group_id, susu_groups(id, name)')
            .in('member_id', memberIds)
            .neq('group_id', id)
            .eq('status', 'active')
          for (const o of others ?? []) {
            const list = (otherByMember[o.member_id] ??= [])
            const hit = list.find(x => x.id === (o as any).susu_groups?.id)
            if (hit) hit.slots++
            else if ((o as any).susu_groups) list.push({ id: (o as any).susu_groups.id, name: (o as any).susu_groups.name, slots: 1 })
          }
        }

        const enriched = (roster ?? []).map((r: any) => ({
          ...r,
          other_groups: otherByMember[r.members?.id] ?? [],
        }))

        return json({ group, roster: enriched })
      }

      const { data, error: e } = await supabaseAdmin
        .from('susu_groups').select('*, group_memberships(count)')
        .order('created_at', { ascending: false })
      if (e) return error(e.message, 500)
      return json({ groups: data })
    }

    return error('Method not allowed', 405)
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
