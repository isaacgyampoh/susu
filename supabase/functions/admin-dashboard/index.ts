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

    /*
     * Totals come from the database, not from JavaScript.
     *
     * This used to be `SELECT amount FROM transactions WHERE status='success'`
     * with no LIMIT, summed here with reduce(). Two problems at once: it pulled
     * the entire successful-payment history over the wire on every dashboard
     * load and grew without bound, and if PostgREST is configured with a row
     * cap the figure was SILENTLY TRUNCATED — so the operator's headline
     * "Total collected" would simply have been wrong, with nothing to show it.
     *
     * get_admin_totals() aggregates in the database and stays correct at any
     * table size. It also returns the live anomaly counts, so the console can
     * surface unresolved financial state instead of hiding it.
     */
    const { data: totals, error: totalsErr } = await supabaseAdmin.rpc('get_admin_totals', {
      p_as_of: new Date().toISOString().slice(0, 10),
    })
    if (totalsErr) return error(`Could not read totals: ${totalsErr.message}`, 500)

    const t = totals as Record<string, any>
    const totalCollected = Number(t?.collected?.all_time ?? 0)

    return json({
      stats: {
        totalMembers:         totalMembers ?? 0,
        activeGroups:         activeGroups ?? 0,
        pendingKYC:           pendingKYC ?? 0,
        overdueContributions: overdueContributions ?? 0,
        totalCollected,
        collectedToday:     Number(t?.collected?.today ?? 0),
        collectedThisMonth: Number(t?.collected?.this_month ?? 0),
        contributionsPaid:  Number(t?.contributions?.paid ?? 0),
        contributionsOutstanding: Number(t?.contributions?.outstanding ?? 0),
        // What is still to collect TODAY, after part-payments. `due_today` is
        // the gross obligation and reads as this figure without being it.
        remainingToday: Number(t?.contributions?.remaining_today ?? 0),
        dueTodayGross: Number(t?.contributions?.due_today ?? 0),
        dueToday:           Number(t?.contributions?.due_today ?? 0),
        paidToday:          Number(t?.contributions?.paid_today ?? 0),
        payoutsUpcoming:    Number(t?.payouts?.upcoming ?? 0),
        payoutsDue7Days:    Number(t?.payouts?.due_7_days ?? 0),
      },
      /** Unresolved financial state, counted in the database. Never hidden. */
      anomalies: t?.anomalies ?? {},
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
