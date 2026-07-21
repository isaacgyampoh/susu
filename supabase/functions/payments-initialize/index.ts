import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireMember }           from '../_shared/jwt.ts'
import { initializeTransaction }   from '../_shared/paystack.ts'
import { requestPayment as moolreRequest } from '../_shared/moolre.ts'
import { requestPayment as naloRequest }   from '../_shared/nalo.ts'
import { provider, devPaymentsAllowed, paymentsUnavailable } from '../_shared/mode.ts'

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
    const { contribution_id } = await req.json()
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
    const ref    = `CONT-${contribution_id}-${Date.now()}`

    // Record the intent before asking for money, so a settlement always has a
    // row to land on — even if the member closes the app mid-prompt.
    async function recordIntent() {
      await supabaseAdmin.from('transactions').insert({
        member_id: session!.sub, type: 'contribution', amount: due,
        reference: ref, description: `Susu contribution for ${contribution.due_date}`,
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
      const momo = member.mobile_money_number ?? member.phone
      if (!momo) return error('No mobile money number on your account. Ask your admin to add one.', 400)

      await recordIntent()

      const res = await requestPayment({
        payer:       momo,
        amount:      due,
        provider:    member.mobile_money_provider ?? 'MTN',
        externalref: ref,
        reference:   'Susu contribution',
      })

      if (res.kind === 'prompted') {
        return json({
          provider: prov, status: 'prompted', reference: ref, amount: due,
          message: `Approve the prompt on ${momo} with your MoMo PIN.`,
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
      email, amount: Math.round(due * 100), reference: ref,
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
