import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'

serveWithCors(async (req) => {
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

    // Today's receipts, split by channel so the admin can reconcile the online
    // total against NaloPay's own dashboard.
    const now = new Date()
    const startOfDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)).toISOString()
    const { data: todayTx } = await supabaseAdmin
      .from('transactions')
      .select('amount, description, paystack_data')
      .eq('status', 'success')
      .in('type', ['contribution', 'bulk_contribution', 'registration_fee'])
      .gte('created_at', startOfDay)

    let onlineTotal = 0, onlineCount = 0, manualTotal = 0, manualCount = 0
    for (const t of todayTx ?? []) {
      const online = !!(t.paystack_data && (t.paystack_data as any).provider_order_id)
      const amt = Number(t.amount ?? 0)
      if (online) { onlineTotal += amt; onlineCount++ }
      else        { manualTotal += amt; manualCount++ }
    }
    const today = {
      total: Math.round((onlineTotal + manualTotal) * 100) / 100,
      count: (todayTx ?? []).length,
      online: { total: Math.round(onlineTotal * 100) / 100, count: onlineCount },
      manual: { total: Math.round(manualTotal * 100) / 100, count: manualCount },
    }

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
      today,
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
