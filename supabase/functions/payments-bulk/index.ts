import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireMember }           from '../_shared/jwt.ts'
import { initializeTransaction } from '../_shared/paystack.ts'
import { requestPayment }        from '../_shared/moolre.ts'
import { requestPayment as naloRequest } from '../_shared/nalo.ts'
import { provider, devPaymentsAllowed, paymentsUnavailable, withServiceCharge } from '../_shared/mode.ts'

const FRONTEND_URL = Deno.env.get('FRONTEND_URL') ?? ''

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const session = await requireMember(req)
  if (!session) return error('Unauthorized', 401)
  const memberId = session.sub as string

  const blocked = paymentsUnavailable(req, error)
  if (blocked) return blocked

  const url = new URL(req.url)

  // ── GET: preview what a bulk payment would cover ──
  if (req.method === 'GET') {
    const groupId = url.searchParams.get('group_id')
    const days    = parseInt(url.searchParams.get('days') ?? '7')

    let q = supabaseAdmin
      .from('contributions')
      .select('id, amount, due_date, status, penalty_due, group_id, susu_groups(id, name)')
      .eq('member_id', memberId)
      .in('status', ['pending', 'overdue'])
      .order('due_date', { ascending: true })
      .limit(days)

    if (groupId) q = q.eq('group_id', groupId)

    const { data: contributions, error: dbErr } = await q
    if (dbErr) return error(dbErr.message, 500)

    const subtotal = (contributions ?? []).reduce((s, c) => s + Number(c.amount), 0)
    const penalties = (contributions ?? []).reduce((s, c) => s + Number(c.penalty_due ?? 0), 0)

    return json({
      contributions,
      count:    contributions?.length ?? 0,
      subtotal,
      penalties,
      total:    subtotal + penalties,
      from:     contributions?.[0]?.due_date ?? null,
      to:       contributions?.[contributions.length - 1]?.due_date ?? null,
    })
  }

  // ── POST: pay multiple contributions in ONE MoMo transaction ──
  if (req.method !== 'POST') return error('Method not allowed', 405)

  try {
    const { contribution_ids, group_id, days, pay_number: payNumber, pay_network: payNetwork } = await req.json()

    // Resolve which contributions to pay
    let ids: string[] = contribution_ids ?? []

    if (ids.length === 0) {
      // Auto-select the next N unpaid contributions
      let q = supabaseAdmin
        .from('contributions')
        .select('id')
        .eq('member_id', memberId)
        .in('status', ['pending', 'overdue'])
        .order('due_date', { ascending: true })
        .limit(days ?? 7)
      if (group_id) q = q.eq('group_id', group_id)
      const { data } = await q
      ids = (data ?? []).map((c: { id: string }) => c.id)
    }

    if (ids.length === 0) return error('No unpaid contributions found')
    if (ids.length > 90) return error('Cannot pay more than 90 contributions at once')

    // Fetch them (and verify ownership)
    const { data: contributions, error: cErr } = await supabaseAdmin
      .from('contributions')
      .select('id, amount, due_date, status, penalty_due, member_id, susu_groups(name)')
      .in('id', ids)
      .eq('member_id', memberId)

    if (cErr) return error(cErr.message, 500)
    if (!contributions || contributions.length === 0) return error('Contributions not found', 404)

    const unpaid = contributions.filter((c: any) => c.status !== 'paid')
    if (unpaid.length === 0) return error('All selected contributions are already paid')

    const subtotal  = unpaid.reduce((s: number, c: any) => s + Number(c.amount), 0)
    const penalties = unpaid.reduce((s: number, c: any) => s + Number(c.penalty_due ?? 0), 0)
    const total     = subtotal + penalties
    const { charged: chargedTotal, fee: chargeFee } = withServiceCharge(total)

    const batchId   = crypto.randomUUID()
    const unpaidIds = unpaid.map((c: any) => c.id)

    // ── DEV MODE: explicit opt-in only ──
    if (devPaymentsAllowed()) {
      const ref = `BULK-DEV-${batchId.slice(0, 8)}`
      await supabaseAdmin.from('contributions')
        .update({ status: 'paid', paid_at: new Date().toISOString(), paystack_ref: ref, batch_id: batchId })
        .in('id', unpaidIds)

      // Clear penalties covered by this batch
      await supabaseAdmin.from('payment_penalties')
        .update({ is_paid: true, paid_at: new Date().toISOString() })
        .in('contribution_id', unpaidIds)

      await supabaseAdmin.from('transactions').insert({
        member_id: memberId, type: 'contribution', amount: total,
        reference: ref, batch_id: batchId, items_count: unpaid.length,
        description: `Bulk payment — ${unpaid.length} contributions (dev mode)`,
        status: 'success',
      })

      return json({
        dev_mode: true,
        message: `${unpaid.length} contributions marked as paid`,
        count: unpaid.length, total, reference: ref,
      })
    }

    // ── LIVE ──
    const { data: member } = await supabaseAdmin
      .from('members')
      .select('email, phone, full_name, mobile_money_number, mobile_money_provider')
      .eq('id', memberId).single()

    const reference = `BULK-${batchId.slice(0, 8)}-${Date.now()}`

    // Prompt providers (Nalo, Moolre): one prompt for the whole batch — the
    // point of paying ahead is one approval, not thirty.
    if (provider() === 'nalo' || provider() === 'moolre') {
      const prov = provider()
      const doRequest = prov === 'nalo' ? naloRequest : requestPayment
      const momo = (payNumber && String(payNumber).trim()) || member?.mobile_money_number || member?.phone
      if (!momo) return error('No mobile money number on your account. Ask your admin to add one.', 400)
      const net = (payNetwork && String(payNetwork).trim()) || member?.mobile_money_provider || 'MTN'

      const providerRef = prov === 'nalo'
        ? `SU${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase().slice(0, 20)
        : reference

      await supabaseAdmin.from('contributions').update({ batch_id: batchId }).in('id', unpaidIds)
      await supabaseAdmin.from('transactions').insert({
        member_id: memberId, type: 'contribution', amount: total,
        reference, batch_id: batchId, items_count: unpaid.length,
        description: `Bulk payment — ${unpaid.length} contributions`, status: 'pending',
        paystack_data: prov === 'nalo' ? { provider_order_id: null } as never : null,
      })

      const res = await doRequest({
        payer: momo, amount: chargedTotal,
        provider: net,
        externalref: providerRef,
        reference: `Susu — ${unpaid.length} days`,
        accountName: member?.full_name,
      })

      if (res.kind === 'prompted') {
        if (res.moolreRef) {
          await supabaseAdmin.from('transactions')
            .update({ paystack_data: { provider_order_id: res.moolreRef } as never })
            .eq('reference', reference)
        }
        return json({ provider: prov, status: 'prompted', reference, count: unpaid.length, total,
          ussd: res.ussd,
          message: res.ussd
            ? `Dial ${res.ussd} on ${momo} to approve GHS ${chargedTotal.toFixed(2)} (incl. GHS ${chargeFee.toFixed(2)} fee).`
            : `Approve GHS ${chargedTotal.toFixed(2)} on ${momo} (incl. GHS ${chargeFee.toFixed(2)} fee).` })
      }
      if (res.kind === 'duplicate') {
        return json({ provider: prov, status: 'prompted', reference, count: unpaid.length, total,
          message: `Approve GHS ${total.toFixed(2)} on ${momo} with your MoMo PIN.` })
      }
      if (res.kind === 'otp_required') {
        return json({ provider: prov, status: 'otp_required', reference, count: unpaid.length, total,
          message: res.message })
      }
      await supabaseAdmin.from('transactions').update({ status: 'failed' }).eq('reference', reference)
      return error(res.message, 400)
    }

    const email     = member?.email ?? `${member?.phone?.replace('+', '')}@susu.platform`

    const paystackRes = await initializeTransaction({
      email,
      amount:       Math.round(total * 100),
      reference,
      callback_url: `${FRONTEND_URL}/member/payments?ref=${reference}`,
      metadata: {
        type: 'bulk_contribution',
        batch_id: batchId,
        member_id: memberId,
        contribution_ids: unpaidIds,
        count: unpaid.length,
        member_name: member?.full_name,
      },
    })

    if (!paystackRes.status) return error('Could not initialize payment', 500)

    // Tag contributions with the batch so the webhook can find them
    await supabaseAdmin.from('contributions').update({ batch_id: batchId }).in('id', unpaidIds)

    await supabaseAdmin.from('transactions').insert({
      member_id: memberId, type: 'contribution', amount: total,
      reference, batch_id: batchId, items_count: unpaid.length,
      description: `Bulk payment — ${unpaid.length} contributions`,
      status: 'pending',
    })

    return json({
      authorization_url: paystackRes.data.authorization_url,
      reference, count: unpaid.length, subtotal, penalties, total,
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
