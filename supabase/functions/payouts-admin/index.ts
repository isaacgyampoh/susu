import { handleCors, json, error } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'
import { sendSMS }                 from '../_shared/africas-talking.ts'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  const url    = new URL(req.url)
  const method = req.method

  try {
    // GET — list payouts
    if (method === 'GET') {
      const status   = url.searchParams.get('status') ?? 'upcoming'
      const group_id = url.searchParams.get('group_id')

      let query = supabaseAdmin
        .from('payouts')
        .select(`
          id, total_amount, scheduled_date, paid_at, status, notes, created_at,
          members(id, member_id, full_name, phone, bank_name, bank_account_number, bank_account_name, mobile_money_number, mobile_money_provider),
          susu_groups(id, name, contribution_amount)
        `)
        .order('scheduled_date', { ascending: true })

      if (status !== 'all') query = query.eq('status', status)
      if (group_id)         query = query.eq('group_id', group_id)

      const { data: payouts, error: dbErr } = await query
      if (dbErr) return error(dbErr.message, 500)
      return json({ payouts })
    }

    // PATCH — mark payout as paid
    if (method === 'PATCH') {
      const { payout_id, notes, paystack_transfer_ref } = await req.json()
      if (!payout_id) return error('payout_id is required')

      const { data: payout, error: fetchErr } = await supabaseAdmin
        .from('payouts')
        .select('*, members(full_name, phone, member_id), susu_groups(name)')
        .eq('id', payout_id)
        .single()

      if (fetchErr || !payout) return error('Payout not found', 404)
      if (payout.status === 'paid') return error('Payout already marked as paid')

      // Mark payout as paid
      await supabaseAdmin
        .from('payouts')
        .update({
          status:               'paid',
          paid_at:              new Date().toISOString(),
          notes,
          paystack_transfer_ref,
          marked_paid_by:       admin.sub,
        })
        .eq('id', payout_id)

      // Update membership
      await supabaseAdmin
        .from('group_memberships')
        .update({ payout_received: true })
        .eq('id', payout.membership_id)

      // Record transaction
      await supabaseAdmin.from('transactions').insert({
        member_id:   payout.member_id,
        type:        'payout',
        amount:      payout.total_amount,
        reference:   paystack_transfer_ref ?? `PAYOUT-${payout_id}`,
        description: `Susu payout from ${payout.susu_groups.name}`,
        status:      'success',
        related_id:  payout_id,
      })

      // Notify member
      const member = payout.members
      await sendSMS(
        member.phone,
        `Congratulations ${member.full_name}! Your Susu payout of GHS ${Number(payout.total_amount).toFixed(2)} from ${payout.susu_groups.name} has been sent. Check your account. 🎉`
      )

      await supabaseAdmin.from('notifications').insert({
        member_id: payout.member_id,
        type:      'sms',
        message:   `Payout of GHS ${payout.total_amount} sent`,
        status:    'sent',
        sent_at:   new Date().toISOString(),
      })

      return json({ message: 'Payout marked as paid and member notified' })
    }

    return error('Method not allowed', 405)
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
