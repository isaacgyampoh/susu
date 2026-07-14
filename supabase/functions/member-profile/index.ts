import { handleCors, json, error } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireMember }           from '../_shared/jwt.ts'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const session = await requireMember(req)
  if (!session) return error('Unauthorized', 401)

  try {
    const memberId = session.sub as string

    // Member profile
    const { data: member, error: mErr } = await supabaseAdmin
      .from('members')
      .select('id, member_id, full_name, phone, email, whatsapp_number, status, occupation, residential_address, mobile_money_number, mobile_money_provider, bank_name, bank_account_number, bank_account_name, created_at')
      .eq('id', memberId)
      .single()

    if (mErr || !member) return error('Member not found', 404)

    // Active memberships with group info and payout details
    const { data: memberships } = await supabaseAdmin
      .from('group_memberships')
      .select(`
        id, payout_position, payout_date, payout_amount, payout_received, status, joined_at,
        susu_groups (id, name, contribution_amount, contribution_frequency, cycle_days, max_members, current_members, status, start_date)
      `)
      .eq('member_id', memberId)
      .eq('status', 'active')

    // Pending contributions (due today or overdue) — max 20
    const { data: pendingContributions } = await supabaseAdmin
      .from('contributions')
      .select('id, amount, due_date, status, group_id, susu_groups(name)')
      .eq('member_id', memberId)
      .in('status', ['pending', 'overdue'])
      .order('due_date', { ascending: true })
      .limit(20)

    // Recent payment history — last 30
    const { data: recentPayments } = await supabaseAdmin
      .from('contributions')
      .select('id, amount, due_date, paid_at, status, paystack_ref, susu_groups(name)')
      .eq('member_id', memberId)
      .order('due_date', { ascending: false })
      .limit(30)

    // Payouts
    const { data: payouts } = await supabaseAdmin
      .from('payouts')
      .select('id, total_amount, scheduled_date, paid_at, status, susu_groups(name)')
      .eq('member_id', memberId)
      .order('scheduled_date', { ascending: true })

    // Announcements (global or for member's groups)
    const groupIds = memberships?.map((m: { susu_groups: { id: string } }) => m.susu_groups?.id).filter(Boolean) ?? []
    const { data: announcements } = await supabaseAdmin
      .from('announcements')
      .select('id, title, content, created_at, susu_groups(name)')
      .or(`is_global.eq.true,group_id.in.(${groupIds.join(',') || 'null'})`)
      .order('created_at', { ascending: false })
      .limit(10)

    // Summary stats
    const totalPaid    = recentPayments?.filter((c: {status: string}) => c.status === 'paid').reduce((sum: number, c: {amount: number}) => sum + Number(c.amount), 0) ?? 0
    const totalPending = pendingContributions?.reduce((sum: number, c: {amount: number}) => sum + Number(c.amount), 0) ?? 0
    const nextPayout   = payouts?.find((p: {status: string}) => p.status === 'upcoming')

    return json({
      member,
      memberships,
      pendingContributions,
      recentPayments,
      payouts,
      announcements,
      summary: {
        totalPaid,
        totalPending,
        nextPayoutDate:   nextPayout?.scheduled_date ?? null,
        nextPayoutAmount: nextPayout?.total_amount ?? null,
        activeGroups:     memberships?.length ?? 0,
      },
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
