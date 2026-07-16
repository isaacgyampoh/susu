import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  const url    = new URL(req.url)
  const page   = parseInt(url.searchParams.get('page') ?? '1')
  const action = url.searchParams.get('action')
  const limit  = 50
  const offset = (page - 1) * limit

  try {
    let q = supabaseAdmin
      .from('audit_log')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (action) q = q.ilike('action', `${action}%`)

    const { data, count, error: e } = await q
    if (e) return error(e.message, 500)
    return json({ entries: data, total: count, page })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
