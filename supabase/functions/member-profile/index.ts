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

    // ALL active memberships with group details + payout info
    const { data: memberships } = await supabaseAdmin
      .from('group_memberships')
      .select(`
        id, payout_position, payout_date, payout_amount, payout_received, status, joined_at,
        susu_groups (
          id, name, description, contribution_amount, contribution_frequency,
          cycle_days, max_members, current_members, status, start_date, end_date,
          cashout_amount, payment_deadline, penalty_per_late_day, registration_fee
        )
      `)
      .eq('member_id', memberId)
      .eq('status', 'active')

    // For each membership build balance summary
    const plansWithBalance = await Promise.all(
      (memberships ?? []).map(async (m: any) => {
        const { data: bal } = await supabaseAdmin.rpc('get_member_plan_balance', {
          p_member_id: memberId,
          p_group_id:  m.susu_groups.id,
        })
        const balance = bal?.[0] ?? {}

        // Next pending contribution for this group
        const { data: nextContrib } = await supabaseAdmin
          .from('contributions')
          .select('id, amount, due_date, status, is_late, is_flagged, penalty_due')
          .eq('member_id', memberId)
          .eq('group_id', m.susu_groups.id)
          .in('status', ['pending', 'overdue'])
          .order('due_date', { ascending: true })
          .limit(1)

        return { ...m, balance, nextContribution: nextContrib?.[0] ?? null }
      })
    )

    // Recent payments across all groups (last 30)
    const { data: recentPayments } = await supabaseAdmin
      .from('contributions')
      .select('id, amount, due_date, paid_at, status, paystack_ref, is_late, is_flagged, penalty_due, susu_groups(id, name)')
      .eq('member_id', memberId)
      .order('due_date', { ascending: false })
      .limit(50)

    // Pending / overdue across all groups
    const { data: pendingContributions } = await supabaseAdmin
      .from('contributions')
      .select('id, amount, due_date, status, is_late, is_flagged, penalty_due, group_id, susu_groups(id, name, payment_deadline)')
      .eq('member_id', memberId)
      .in('status', ['pending', 'overdue'])
      .order('due_date', { ascending: true })
      .limit(30)

    // All payouts
    const { data: payouts } = await supabaseAdmin
      .from('payouts')
      .select('id, total_amount, scheduled_date, paid_at, status, susu_groups(id, name)')
      .eq('member_id', memberId)
      .order('scheduled_date', { ascending: true })

    // Penalty balance
    const { data: penalties } = await supabaseAdmin
      .from('payment_penalties')
      .select('id, amount, reason, is_paid, created_at, susu_groups(name)')
      .eq('member_id', memberId)
      .eq('is_paid', false)

    // Announcements
    const groupIds = (memberships ?? []).map((m: any) => m.susu_groups?.id).filter(Boolean)
    const announcementQuery = supabaseAdmin
      .from('announcements')
      .select('id, title, content, created_at, susu_groups(name)')
      .order('created_at', { ascending: false })
      .limit(10)

    const { data: announcements } = groupIds.length > 0
      ? await announcementQuery.or(`is_global.eq.true,group_id.in.(${groupIds.join(',')})`)
      : await announcementQuery.eq('is_global', true)

    // Contact messages (member's own)
    const { data: myMessages } = await supabaseAdmin
      .from('contact_messages')
      .select('id, subject, message, is_read, reply_text, replied_at, created_at')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
      .limit(10)

    // Global summary
    const totalPaidAll    = (recentPayments ?? []).filter((c: any) => c.status === 'paid').reduce((s: number, c: any) => s + Number(c.amount), 0)
    const totalPendingAll = (pendingContributions ?? []).reduce((s: number, c: any) => s + Number(c.amount), 0)
    const totalPenalties  = (penalties ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0)
    const nextPayout      = (payouts ?? []).find((p: any) => p.status === 'upcoming')

    return json({
      member,
      plans: plansWithBalance,          // memberships enriched with balance + next contribution
      pendingContributions,
      recentPayments,
      payouts,
      penalties,
      announcements,
      myMessages,
      summary: {
        totalPaidAll,
        totalPendingAll,
        totalPenalties,
        activePlans:      (memberships ?? []).length,
        nextPayoutDate:   nextPayout?.scheduled_date ?? null,
        nextPayoutAmount: nextPayout?.total_amount ?? null,
        nextPayoutGroup:  (nextPayout as any)?.susu_groups?.name ?? null,
      },
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
