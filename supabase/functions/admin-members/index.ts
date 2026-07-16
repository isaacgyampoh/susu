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

  try {
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
