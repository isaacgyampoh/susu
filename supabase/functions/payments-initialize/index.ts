import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireMember }           from '../_shared/jwt.ts'
import { initializeTransaction }   from '../_shared/paystack.ts'
import { requestPayment as moolreRequest } from '../_shared/moolre.ts'
import { requestPayment as naloRequest }   from '../_shared/nalo.ts'
import { provider, devPaymentsAllowed, paymentsUnavailable, withServiceCharge, serviceChargePct } from '../_shared/mode.ts'

const FRONTEND_URL = Deno.env.get('MEMBER_URL') ?? Deno.env.get('FRONTEND_URL') ?? ''

serveWithCors(async (req) => {
  const c = handleCors(req)
  if (c) return c
  if (req.method !== 'POST') return error('Method not allowed', 405)

  const session = await requireMember(req)
  if (!session) return error('Unauthorized', 401)

  const blocked = paymentsUnavailable(req, error)
  if (blocked) return blocked

  try {
    const { contribution_id, registration_tx_id, pay_number, pay_network } = await req.json()

    // ── REGISTRATION FEE: pay a pending registration_fee transaction ──
    if (registration_tx_id) {
      const { data: regTx } = await supabaseAdmin
        .from('transactions')
        .select('id, amount, status, reference, members!member_id(phone, full_name, mobile_money_number, mobile_money_provider)')
        .eq('id', registration_tx_id)
        .eq('member_id', session.sub)
        .eq('type', 'registration_fee')
        .single()
      if (!regTx) return error('Registration fee not found', 404)
      if (regTx.status === 'success') return error('Registration fee already paid')

      const rmember = regTx.members as any
      const rdue = Number(regTx.amount)
      const { charged: rcharged, fee: rfee } = withServiceCharge(rdue)
      const rRef = `REGPAY-${registration_tx_id}-${Date.now()}`
      const rProviderRef = `RG${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase().slice(0, 20)

      if (devPaymentsAllowed()) {
        await supabaseAdmin.from('transactions').update({ status: 'success' }).eq('id', registration_tx_id)
        return json({ dev_mode: true, message: 'Registration fee recorded (dev mode)' })
      }

      if (provider() === 'nalo' || provider() === 'moolre') {
        const prov = provider()
        const doReq = prov === 'nalo' ? naloRequest : moolreRequest
        const momo = (pay_number && String(pay_number).trim()) || rmember?.mobile_money_number || rmember?.phone
        if (!momo) return error('Enter a mobile money number to pay.', 400)
        const net = (pay_network && String(pay_network).trim()) || rmember?.mobile_money_provider || 'MTN'

        // Point the settlement at THIS registration transaction
        await supabaseAdmin.from('transactions')
          .update({ reference: rRef, description: `Registration fee (charged GHS ${rcharged.toFixed(2)} incl. ${serviceChargePct()}% fee)` })
          .eq('id', registration_tx_id)

        const res = await doReq({
          payer: momo, amount: rcharged, provider: net,
          externalref: prov === 'nalo' ? rProviderRef : rRef,
          reference: 'Susu registration', accountName: rmember?.full_name,
        })
        if (res.kind === 'prompted') {
          if (res.moolreRef) {
            await supabaseAdmin.from('transactions')
              .update({ paystack_data: { provider_order_id: res.moolreRef } as never })
              .eq('id', registration_tx_id)
          }
          return json({
            provider: prov, status: 'prompted', reference: rRef, amount: rcharged,
            ussd: res.ussd, amount_charged: rcharged, fee: rfee,
            message: res.ussd
              ? `Dial ${res.ussd} on ${momo} to pay your GHS ${rcharged.toFixed(2)} registration fee.`
              : `Approve GHS ${rcharged.toFixed(2)} on ${momo} to pay your registration fee.`,
          })
        }
        if (res.kind === 'otp_required') return json({ provider: prov, status: 'otp_required', reference: rRef, amount: rcharged, message: res.message })
        return error(res.kind === 'failed' ? res.message : 'Could not start payment', 400)
      }
      return error('Online payment is not available. Please pay your registration fee to the admin.', 503)
    }

    if (!contribution_id) return error('contribution_id is required')

    const { data: contribution } = await supabaseAdmin
      .from('contributions')
      .select('*, members(email, phone, full_name, mobile_money_number, mobile_money_provider)')
      .eq('id', contribution_id)
      .eq('member_id', session.sub)
      .single()

    if (!contribution) return error('Contribution not found', 404)
    if (contribution.status === 'paid') return error('This contribution is already paid')

    const member = contribution.members as any
    const due    = Number(contribution.amount) + Number(contribution.penalty_due ?? 0)
    // The member is charged the contribution PLUS the service charge; their
    // contribution record stays at `due`. `charged` is what MoMo debits.
    const { charged, fee } = withServiceCharge(due)
    const ref    = `CONT-${contribution_id}-${Date.now()}`
    // NaloPay rejects long/complex references ("Invalid reference"), so send it
    // a short alphanumeric one. It's kept only for the provider; we track the
    // payment by our own `ref` and NaloPay's order_id.
    const providerRef = `SU${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase().slice(0, 20)

    // Record the intent before asking for money, so a settlement always has a
    // row to land on — even if the member closes the app mid-prompt.
    async function recordIntent() {
      await supabaseAdmin.from('transactions').insert({
        member_id: session!.sub, type: 'contribution', amount: due,
        reference: ref, description: `Susu contribution for ${contribution.due_date} (charged GHS ${charged.toFixed(2)} incl. ${serviceChargePct()}% fee)`,
        status: 'pending', related_id: contribution_id,
      })
    }

    // ── DEV ──
    if (devPaymentsAllowed()) {
      const devRef = `DEV-${contribution_id}-${Date.now()}`
      await supabaseAdmin.from('contributions')
        .update({ status: 'paid', paid_at: new Date().toISOString(), paystack_ref: devRef })
        .eq('id', contribution_id)
      await supabaseAdmin.from('transactions').insert({
        member_id: session.sub, type: 'contribution', amount: due, reference: devRef,
        description: 'Dev payment (no provider configured)', status: 'success', related_id: contribution_id,
      })
      return json({ dev_mode: true, message: 'Payment recorded (dev mode)', reference: devRef })
    }

    // ── PROMPT PROVIDERS (Nalo, Moolre): a prompt on the member's phone ──
    if (provider() === 'nalo' || provider() === 'moolre') {
      const prov = provider()
      const requestPayment = prov === 'nalo' ? naloRequest : moolreRequest
      // The member may pay from a DIFFERENT number than the one on file —
      // e.g. their registration number has no MoMo. Honour a chosen number.
      const momo = (pay_number && String(pay_number).trim())
        || member.mobile_money_number || member.phone
      if (!momo) return error('No mobile money number. Enter one to pay.', 400)
      const net = (pay_network && String(pay_network).trim())
        || member.mobile_money_provider || 'MTN'

      await recordIntent()

      const res = await requestPayment({
        payer:       momo,
        amount:      charged,
        provider:    net,
        externalref: prov === 'nalo' ? providerRef : ref,
        reference:   'Susu contribution',
        accountName: member.full_name,
      })

      if (res.kind === 'prompted') {
        // NaloPay verifies by ITS order_id (res.moolreRef), not our ref —
        // persist it so verify/webhook can look the payment up.
        if (res.moolreRef) {
          await supabaseAdmin.from('transactions')
            .update({ paystack_data: { provider_order_id: res.moolreRef } as never })
            .eq('reference', ref)
        }
        return json({
          provider: prov, status: 'prompted', reference: ref, amount: due,
          ussd: res.kind === 'prompted' ? res.ussd : undefined,
          amount_charged: charged, fee,
          message: (res.kind === 'prompted' && res.ussd)
            ? `Dial ${res.ussd} on ${momo} to approve GHS ${charged.toFixed(2)} (incl. GHS ${fee.toFixed(2)} fee).`
            : `Approve GHS ${charged.toFixed(2)} on ${momo} (incl. GHS ${fee.toFixed(2)} charge).`,
        })
      }
      if (res.kind === 'otp_required') {
        // Not an error: the network wants a code first. Keep the same reference.
        return json({
          provider: prov, status: 'otp_required', reference: ref, amount: due,
          message: res.message,
        })
      }
      if (res.kind === 'duplicate') {
        return json({ provider: prov, status: 'prompted', reference: ref, amount: due,
          message: 'Already sent — approve the prompt on your phone.' })
      }

      await supabaseAdmin.from('transactions').update({ status: 'failed' }).eq('reference', ref)
      return error(res.message, 400)
    }

    // ── PAYSTACK: redirect ──
    const email = member.email ?? `${String(member.phone).replace('+', '')}@susu.platform`
    const pay = await initializeTransaction({
      email, amount: Math.round(charged * 100), reference: ref,
      callback_url: `${FRONTEND_URL}/m/portal/payments?ref=${ref}`,
      metadata: { type: 'contribution', contribution_id, member_id: session.sub, member_name: member.full_name },
    })
    if (!pay.status) return error('Could not start payment', 500)

    await recordIntent()
    return json({ provider: 'paystack', authorization_url: pay.data.authorization_url, reference: ref, amount: due })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
