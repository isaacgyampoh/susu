import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin, requireMember } from '../_shared/jwt.ts'

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const url    = new URL(req.url)
  const method = req.method

  try {
    // Try member auth first
    const member = await requireMember(req)
    if (member) {
      const status   = url.searchParams.get('status')
      const group_id = url.searchParams.get('group_id')
      const page     = parseInt(url.searchParams.get('page') ?? '1')
      const limit    = 20
      const offset   = (page - 1) * limit

      let query = supabaseAdmin
        .from('contributions')
        .select('id, amount, due_date, paid_at, status, paystack_ref, cycle_number, susu_groups(id, name)', { count: 'exact' })
        .eq('member_id', member.sub as string)
        .order('due_date', { ascending: false })
        .range(offset, offset + limit - 1)

      if (status) query = query.eq('status', status)
      if (group_id) query = query.eq('group_id', group_id)

      const { data: contributions, count, error: dbErr } = await query
      if (dbErr) return error(dbErr.message, 500)
      return json({ contributions, total: count, page, limit })
    }

    // Try admin auth
    const admin = await requireAdmin(req)
    if (admin) {
      const status    = url.searchParams.get('status')
      const group_id  = url.searchParams.get('group_id')
      const member_id = url.searchParams.get('member_id')
      const sortAsc   = url.searchParams.get('sort') === 'asc'   // oldest first, for collection
      const page      = parseInt(url.searchParams.get('page') ?? '1')
      const limit     = 30
      const offset    = (page - 1) * limit

      let query = supabaseAdmin
        .from('contributions')
        .select(`
          id, amount, due_date, paid_at, status, paystack_ref, cycle_number, created_at,
          members(id, member_id, full_name, phone),
          susu_groups(id, name)
        `, { count: 'exact' })
        .order('due_date', { ascending: sortAsc })
        .range(offset, offset + limit - 1)

      if (status)    query = query.eq('status', status)
      if (group_id)  query = query.eq('group_id', group_id)
      if (member_id) query = query.eq('member_id', member_id)

      const { data: contributions, count, error: dbErr } = await query
      if (dbErr) return error(dbErr.message, 500)
      return json({ contributions, total: count, page, limit })
    }

    return error('Unauthorized', 401)
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
