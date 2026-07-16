import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'
import { sendSMS }                 from '../_shared/africas-talking.ts'

async function audit(admin: any, action: string, entityId: string, label: string, details: unknown) {
  await supabaseAdmin.from('audit_log').insert({
    admin_id: admin.sub, admin_name: admin.full_name ?? admin.email,
    action, entity_type: 'payout', entity_id: entityId, entity_label: label, details,
  })
}

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  const url    = new URL(req.url)
  const method = req.method

  try {
    // ── GET ?eligibility=<payout_id> — check before paying ──
    const eligibilityId = url.searchParams.get('eligibility')
    if (method === 'GET' && eligibilityId) {
      const { data, error: e } = await supabaseAdmin
        .rpc('check_payout_eligibility', { p_payout_id: eligibilityId })
      if (e) return error(e.message, 500)
      return json({ eligibility: data?.[0] ?? null })
    }

    // ── GET — list payouts ──
    if (method === 'GET') {
      const status   = url.searchParams.get('status') ?? 'upcoming'
      const group_id = url.searchParams.get('group_id')

      let query = supabaseAdmin
        .from('payouts')
        .select(`
          id, total_amount, scheduled_date, paid_at, status, notes, created_at,
          outstanding_at_payout, deductions, net_amount, paystack_transfer_ref,
          members(id, member_id, full_name, phone, mobile_money_number, mobile_money_provider, bank_name, bank_account_number, bank_account_name),
          susu_groups(id, name, contribution_amount, registration_fee)
        `)
        .order('scheduled_date', { ascending: true })

      if (status !== 'all') query = query.eq('status', status)
      if (group_id)         query = query.eq('group_id', group_id)

      const { data: payouts, error: dbErr } = await query
      if (dbErr) return error(dbErr.message, 500)
      return json({ payouts })
    }

    // ── PATCH — mark as paid (with eligibility enforcement) ──
    if (method === 'PATCH') {
      const { payout_id, notes, paystack_transfer_ref, override_eligibility } = await req.json()
      if (!payout_id) return error('payout_id is required')

      const { data: payout } = await supabaseAdmin
        .from('payouts')
        .select('*, members(full_name, phone, member_id), susu_groups(name)')
        .eq('id', payout_id).single()

      if (!payout) return error('Payout not found', 404)
      if (payout.status === 'paid') return error('Payout already marked as paid')

      // Run eligibility check
      const { data: elig } = await supabaseAdmin
        .rpc('check_payout_eligibility', { p_payout_id: payout_id })
      const e = elig?.[0]

      if (e && !e.eligible && !override_eligibility) {
        return json({
          blocked: true,
          eligibility: e,
          message: e.reason,
        }, 409)
      }

      const netAmount = e?.net_amount ?? payout.total_amount
      const deductions = (e?.outstanding_contrib ?? 0) + (e?.outstanding_penalty ?? 0)

      await supabaseAdmin.from('payouts').update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        notes, paystack_transfer_ref,
        marked_paid_by: admin.sub,
        eligibility_checked_at: new Date().toISOString(),
        outstanding_at_payout: e?.outstanding_contrib ?? 0,
        deductions,
        net_amount: netAmount,
      }).eq('id', payout_id)

      await supabaseAdmin.from('group_memberships')
        .update({ payout_received: true }).eq('id', payout.membership_id)

      // Settle any penalties that were deducted
      if ((e?.outstanding_penalty ?? 0) > 0) {
        await supabaseAdmin.from('payment_penalties')
          .update({ is_paid: true, paid_at: new Date().toISOString() })
          .eq('member_id', payout.member_id).eq('group_id', payout.group_id).eq('is_paid', false)
      }

      await supabaseAdmin.from('transactions').insert({
        member_id: payout.member_id, type: 'payout', amount: netAmount,
        reference: paystack_transfer_ref ?? `PAYOUT-${payout_id}`,
        description: `Cashout — ${payout.susu_groups.name}`,
        status: 'success', related_id: payout_id,
      })

      const m = payout.members
      await sendSMS(m.phone,
        `Congratulations ${m.full_name}! Your Susu cashout of GHS ${Number(netAmount).toFixed(2)} from ${payout.susu_groups.name} has been sent. Check your MoMo.`)

      await audit(admin, 'payout.marked_paid', payout_id,
        `${m.member_id} — ${m.full_name}`,
        { gross: payout.total_amount, deductions, net: netAmount, ref: paystack_transfer_ref })

      return json({
        message: 'Payout recorded and member notified',
        net_amount: netAmount,
        deductions,
      })
    }

    return error('Method not allowed', 405)
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
