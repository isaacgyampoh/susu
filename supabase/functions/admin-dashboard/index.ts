import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  try {
    const [
      { count: totalMembers },
      { count: activeGroups },
      { count: pendingKYC },
      { count: overdueContributions },
      { data: recentKYC },
      { data: recentTransactions },
      { data: upcomingPayouts },
      { data: groups },
    ] = await Promise.all([
      supabaseAdmin.from('members').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabaseAdmin.from('susu_groups').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabaseAdmin.from('kyc_applications').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
      supabaseAdmin.from('contributions').select('*', { count: 'exact', head: true }).eq('status', 'overdue'),
      supabaseAdmin.from('kyc_applications')
        .select('id, full_name, phone, status, submitted_at, susu_groups(name)')
        .order('submitted_at', { ascending: false })
        .limit(8),
      supabaseAdmin.from('transactions')
        .select('id, type, amount, status, reference, created_at, members(full_name, member_id)')
        .order('created_at', { ascending: false })
        .limit(10),
      supabaseAdmin.from('payouts')
        .select('id, total_amount, scheduled_date, status, members(full_name, member_id), susu_groups(name)')
        .eq('status', 'upcoming')
        .lte('scheduled_date', new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0])
        .order('scheduled_date', { ascending: true })
        .limit(5),
      supabaseAdmin.from('susu_groups')
        .select('id, name, status, current_members, max_members, contribution_amount, contribution_frequency')
        .order('created_at', { ascending: false }),
    ])

    // Total collected (successful transactions)
    const { data: totalData } = await supabaseAdmin
      .from('transactions')
      .select('amount')
      .eq('status', 'success')
      .in('type', ['registration_fee', 'contribution'])

    const totalCollected = totalData?.reduce((s, t) => s + Number(t.amount), 0) ?? 0

    return json({
      stats: {
        totalMembers:         totalMembers ?? 0,
        activeGroups:         activeGroups ?? 0,
        pendingKYC:           pendingKYC ?? 0,
        overdueContributions: overdueContributions ?? 0,
        totalCollected,
      },
      recentKYC,
      recentTransactions,
      upcomingPayouts,
      groups,
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
