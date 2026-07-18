import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'
import { sendSMS }                 from '../_shared/africas-talking.ts'

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  const url    = new URL(req.url)
  const method = req.method
  const id     = url.searchParams.get('id')
  const membershipId = url.searchParams.get('membership_id')

  try {
    // PATCH /admin-members?membership_id=xxx — edit payout details on a plan
    if (method === 'PATCH' && membershipId) {
      const body = await req.json()

      const { data: gm } = await supabaseAdmin
        .from('group_memberships')
        .select('id, member_id, group_id, payout_position, payout_received, susu_groups(name)')
        .eq('id', membershipId).single()
      if (!gm) return error('Membership not found', 404)
      if (gm.payout_received) return error('This payout has already been received and cannot be edited', 400)

      const updates: Record<string, unknown> = {}

      if (body.payout_position !== undefined && body.payout_position !== null && body.payout_position !== '') {
        const newPos = Number(body.payout_position)
        if (!Number.isInteger(newPos) || newPos < 1) return error('payout_position must be a positive whole number')
        if (newPos !== gm.payout_position) {
          const { data: clash } = await supabaseAdmin
            .from('group_memberships').select('id')
            .eq('group_id', gm.group_id).eq('payout_position', newPos)
            .neq('id', membershipId).maybeSingle()
          if (clash) return error(`Payout position #${newPos} is already taken in this group`, 409)
          updates.payout_position = newPos
        }
      }
      if (body.payout_date !== undefined)   updates.payout_date   = body.payout_date || null
      if (body.payout_amount !== undefined && body.payout_amount !== '') {
        const amt = Number(body.payout_amount)
        if (isNaN(amt) || amt < 0) return error('payout_amount must be a positive number')
        updates.payout_amount = amt
      }

      if (Object.keys(updates).length === 0) return error('Nothing to update')

      const { error: upErr } = await supabaseAdmin
        .from('group_memberships').update(updates).eq('id', membershipId)
      if (upErr) return error(upErr.message, 500)

      // Keep the payouts schedule in step with the membership
      const { data: upcoming } = await supabaseAdmin
        .from('payouts').select('id')
        .eq('membership_id', membershipId).eq('status', 'upcoming')
        .maybeSingle()

      const newDate   = updates.payout_date !== undefined ? updates.payout_date : undefined
      const newAmount = updates.payout_amount

      if (newDate === null && upcoming) {
        // Date cleared — remove the scheduled payout
        await supabaseAdmin.from('payouts').delete().eq('id', upcoming.id)
      } else if (upcoming) {
        const patch: Record<string, unknown> = {}
        if (typeof newDate === 'string') patch.scheduled_date = newDate
        if (newAmount !== undefined)     patch.total_amount   = newAmount
        if (Object.keys(patch).length) await supabaseAdmin.from('payouts').update(patch).eq('id', upcoming.id)
      } else if (typeof newDate === 'string') {
        // Date newly set and no scheduled payout yet — create one
        const { data: fresh } = await supabaseAdmin
          .from('group_memberships').select('payout_amount').eq('id', membershipId).single()
        await supabaseAdmin.from('payouts').insert({
          member_id: gm.member_id, group_id: gm.group_id, membership_id: membershipId,
          total_amount: fresh?.payout_amount ?? 0, scheduled_date: newDate,
          status: 'upcoming', notes: 'Scheduled by admin edit',
        })
      }

      return json({ message: 'Payout details updated' })
    }

    // GET /admin-members — list all members with filters
    if (method === 'GET' && !id) {
      const status = url.searchParams.get('status') ?? 'active'
      const search = url.searchParams.get('search')
      const page   = parseInt(url.searchParams.get('page') ?? '1')
      const limit  = 20
      const offset = (page - 1) * limit

      let query = supabaseAdmin
        .from('members')
        .select(`
          id, member_id, full_name, phone, email, status, created_at,
          group_memberships(count),
          contributions(count)
        `, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (status !== 'all') query = query.eq('status', status)
      if (search) query = query.or(`full_name.ilike.%${search}%,phone.ilike.%${search}%,member_id.ilike.%${search}%`)

      const { data: members, count, error: dbErr } = await query
      if (dbErr) return error(dbErr.message, 500)

      return json({ members, total: count, page, limit })
    }

    // GET /admin-members?id=xxx — single member detail
    if (method === 'GET' && id) {
      const { data: member, error: dbErr } = await supabaseAdmin
        .from('members')
        .select(`
          *,
          group_memberships(
            id, payout_position, payout_date, payout_amount, payout_received, status, joined_at,
            susu_groups(id, name, contribution_amount, status)
          ),
          contributions(id, amount, due_date, paid_at, status, paystack_ref, susu_groups(name)),
          payouts(id, total_amount, scheduled_date, paid_at, status, susu_groups(name)),
          transactions(id, type, amount, status, reference, created_at)
        `)
        .eq('id', id)
        .single()

      if (dbErr) return error('Member not found', 404)
      return json({ member })
    }

    // PATCH /admin-members?id=xxx — update member status
    if (method === 'PATCH' && id) {
      const { status, message } = await req.json()
      const allowed = ['active','suspended','removed']
      if (!allowed.includes(status)) return error(`status must be one of: ${allowed.join(', ')}`)

      const { data: member } = await supabaseAdmin
        .from('members')
        .update({ status })
        .eq('id', id)
        .select('full_name, phone')
        .single()

      if (member && message) {
        await sendSMS(member.phone, `Hi ${member.full_name}, ${message}`)
        await supabaseAdmin.from('notifications').insert({
          member_id: id, type: 'sms', message, status: 'sent', sent_at: new Date().toISOString(),
        })
      }

      return json({ message: `Member status updated to ${status}` })
    }

    return error('Not found', 404)
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
