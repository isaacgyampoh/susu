import { handleCors, corsHeaders, error } from '../_shared/cors.ts'
import { supabaseAdmin }                  from '../_shared/supabase-admin.ts'
import { requireAdmin }                   from '../_shared/jwt.ts'

function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n')
}

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  const url    = new URL(req.url)
  const report = url.searchParams.get('report') ?? 'contributions'
  const group  = url.searchParams.get('group_id')

  try {
    let rows: Record<string, unknown>[] = []

    if (report === 'contributions') {
      let q = supabaseAdmin.from('contributions')
        .select('due_date, amount, status, paid_at, is_late, penalty_due, paystack_ref, members(member_id, full_name, phone), susu_groups(name)')
        .order('due_date', { ascending: false }).limit(5000)
      if (group) q = q.eq('group_id', group)
      const { data } = await q
      rows = (data ?? []).map((c: any) => ({
        member_id: c.members?.member_id, member_name: c.members?.full_name, phone: c.members?.phone,
        group: c.susu_groups?.name, due_date: c.due_date, amount: c.amount, status: c.status,
        paid_at: c.paid_at ?? '', late: c.is_late ? 'YES' : 'NO',
        penalty: c.penalty_due ?? 0, reference: c.paystack_ref ?? '',
      }))
    }

    else if (report === 'payouts') {
      let q = supabaseAdmin.from('payouts')
        .select('scheduled_date, total_amount, net_amount, deductions, status, paid_at, paystack_transfer_ref, members(member_id, full_name, phone, mobile_money_number), susu_groups(name)')
        .order('scheduled_date', { ascending: true }).limit(5000)
      if (group) q = q.eq('group_id', group)
      const { data } = await q
      rows = (data ?? []).map((p: any) => ({
        member_id: p.members?.member_id, member_name: p.members?.full_name,
        momo: p.members?.mobile_money_number ?? '', group: p.susu_groups?.name,
        scheduled_date: p.scheduled_date, gross: p.total_amount,
        deductions: p.deductions ?? 0, net: p.net_amount ?? p.total_amount,
        status: p.status, paid_at: p.paid_at ?? '', transfer_ref: p.paystack_transfer_ref ?? '',
      }))
    }

    else if (report === 'members') {
      const { data } = await supabaseAdmin.from('members')
        .select('member_id, full_name, phone, email, status, ghana_card_number, mobile_money_provider, mobile_money_number, occupation, created_at')
        .order('created_at', { ascending: false }).limit(5000)
      rows = (data ?? []) as any[]
    }

    else if (report === 'defaulters') {
      const { data } = await supabaseAdmin.from('group_memberships')
        .select('forfeited_at, forfeit_reason, payout_position, status, members(member_id, full_name, phone), susu_groups(name)')
        .eq('status', 'defaulted').order('forfeited_at', { ascending: false })
      rows = (data ?? []).map((m: any) => ({
        member_id: m.members?.member_id, member_name: m.members?.full_name, phone: m.members?.phone,
        group: m.susu_groups?.name, position: m.payout_position,
        forfeited_at: m.forfeited_at, reason: m.forfeit_reason,
      }))
    }

    else return error('Unknown report type. Use: contributions | payouts | members | defaulters')

    const csv  = toCSV(rows)
    const date = new Date().toISOString().split('T')[0]

    return new Response(csv, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="susu-${report}-${date}.csv"`,
      },
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
