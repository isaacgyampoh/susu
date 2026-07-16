import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { sendSMS, smsTemplates }   from '../_shared/africas-talking.ts'
import { verifyPaystackSignature, isPaystackConfigured } from '../_shared/paystack-verify.ts'

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (req.method !== 'POST') return error('Method not allowed', 405)

  try {
    const rawBody = await req.text()

    // Reject anything that isn't provably from Paystack.
    // Without this, this endpoint hands out free contributions.
    if (!isPaystackConfigured()) {
      console.error('webhook: PAYSTACK_SECRET_KEY not set — rejecting')
      return error('Webhook not configured', 503)
    }
    const signature = req.headers.get('x-paystack-signature')
    if (!(await verifyPaystackSignature(rawBody, signature))) {
      console.warn('webhook: invalid signature — rejected')
      return error('Invalid signature', 401)
    }

    const payload = JSON.parse(rawBody)
    const { event, data } = payload

    if (event !== 'charge.success') return json({ received: true })

    const { reference, metadata, amount, customer } = data
    const amountGHS = amount / 100

    // Already processed?
    const { data: existing } = await supabaseAdmin
      .from('transactions')
      .select('id')
      .eq('reference', reference)
      .eq('status', 'success')
      .maybeSingle()

    if (existing) return json({ received: true })

    // Handle registration fee payment
    if (metadata?.type === 'registration_fee') {
      const kycId = metadata.kyc_id
      await supabaseAdmin
        .from('kyc_applications')
        .update({ registration_fee_paid: true, registration_fee_ref: reference })
        .eq('id', kycId)

      await supabaseAdmin.from('transactions').upsert({
        type:          'registration_fee',
        amount:        amountGHS,
        reference,
        description:   'Susu registration fee',
        status:        'success',
        paystack_data: data,
        related_id:    kycId,
      }, { onConflict: 'reference' })

      return json({ received: true })
    }

    // Handle contribution payment
    if (metadata?.type === 'contribution') {
      const { contribution_id, member_id } = metadata

      // Paystack is authoritative on amount, but confirm it covers the debt —
      // a short payment must not clear a full contribution.
      const { data: owed } = await supabaseAdmin
        .from('contributions').select('amount, penalty_due')
        .eq('id', contribution_id).single()
      const due = Number(owed?.amount ?? 0) + Number(owed?.penalty_due ?? 0)
      if (owed && amountGHS + 0.01 < due) {
        console.warn(`webhook: short payment ${amountGHS} < ${due} for ${contribution_id}`)
        return json({ received: true, ignored: 'amount below due' })
      }

      await supabaseAdmin
        .from('contributions')
        .update({ status: 'paid', paid_at: new Date().toISOString(), paystack_ref: reference, paystack_data: data })
        .eq('id', contribution_id)

      await supabaseAdmin.from('transactions').upsert({
        member_id,
        type:          'contribution',
        amount:        amountGHS,
        reference,
        description:   'Susu daily contribution',
        status:        'success',
        paystack_data: data,
        related_id:    contribution_id,
      }, { onConflict: 'reference' })

      // Fetch member for SMS
      const { data: member } = await supabaseAdmin
        .from('members')
        .select('full_name, phone')
        .eq('id', member_id)
        .single()

      if (member) {
        await sendSMS(member.phone, smsTemplates.paymentConfirmed(member.full_name, amountGHS.toFixed(2), reference))

        await supabaseAdmin.from('notifications').insert({
          member_id, type: 'sms',
          message: `Payment confirmation SMS sent for GHS ${amountGHS}`,
          status: 'sent', sent_at: new Date().toISOString(),
        })
      }

      return json({ received: true })
    }


    // Handle BULK contribution payment
    if (metadata?.type === 'bulk_contribution') {
      const { batch_id, member_id, contribution_ids, count } = metadata

      await supabaseAdmin
        .from('contributions')
        .update({ status: 'paid', paid_at: new Date().toISOString(), paystack_ref: reference })
        .in('id', contribution_ids)

      // Clear any penalties attached to those contributions
      await supabaseAdmin
        .from('payment_penalties')
        .update({ is_paid: true, paid_at: new Date().toISOString() })
        .in('contribution_id', contribution_ids)

      await supabaseAdmin.from('transactions').upsert({
        member_id, type: 'contribution', amount: amountGHS,
        reference, batch_id, items_count: count,
        description: `Bulk payment — ${count} contributions`,
        status: 'success', paystack_data: data,
      }, { onConflict: 'reference' })

      const { data: member } = await supabaseAdmin
        .from('members').select('full_name, phone').eq('id', member_id).single()

      if (member) {
        await sendSMS(member.phone,
          `Hi ${member.full_name}, your bulk payment of GHS ${amountGHS.toFixed(2)} covering ${count} contributions is confirmed. Ref: ${reference}. Thank you!`)
      }

      return json({ received: true })
    }

    return json({ received: true })
  } catch (e) {
    console.error('Webhook error:', e)
    return json({ received: true }) // Always return 200 to Paystack
  }
})
