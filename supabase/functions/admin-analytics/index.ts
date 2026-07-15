import { handleCors, json, error } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  const url     = new URL(req.url)
  const groupId = url.searchParams.get('group_id')

  try {
    // Per-group financials
    if (groupId) {
      const { data, error: e } = await supabaseAdmin
        .rpc('get_group_financials', { p_group_id: groupId })
      if (e) return error(e.message, 500)
      return json({ financials: data?.[0] ?? null })
    }

    // Platform-wide
    const [analytics, trend, groups] = await Promise.all([
      supabaseAdmin.rpc('get_platform_analytics'),
      supabaseAdmin.rpc('get_collection_trend', { p_days: 14 }),
      supabaseAdmin.from('susu_groups').select('id, name, status').eq('status', 'active'),
    ])

    if (analytics.error) return error(analytics.error.message, 500)

    // Financials per active group
    const groupFinancials = await Promise.all(
      (groups.data ?? []).map(async (g: { id: string; name: string }) => {
        const { data } = await supabaseAdmin.rpc('get_group_financials', { p_group_id: g.id })
        return { group_id: g.id, group_name: g.name, ...(data?.[0] ?? {}) }
      })
    )

    return json({
      analytics: analytics.data?.[0] ?? null,
      trend:     trend.data ?? [],
      groupFinancials,
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
