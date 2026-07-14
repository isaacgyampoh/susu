import { handleCors, json, error } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireMember }           from '../_shared/jwt.ts'
import { initializeTransaction }   from '../_shared/paystack.ts'

const FRONTEND_URL = Deno.env.get('FRONTEND_URL') ?? 'https://susuplatform.vercel.app'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (req.method !== 'POST') return error('Method not allowed', 405)

  const session = await requireMember(req)
  if (!session) return error('Unauthorized', 401)

  try {
    const { contribution_id } = await req.json()
    if (!contribution_id) return error('contribution_id is required')

    // Fetch contribution
    const { data: contribution, error: cErr } = await supabaseAdmin
      .from('contributions')
      .select('*, members(email, phone, full_name)')
      .eq('id', contribution_id)
      .eq('member_id', session.sub)
      .single()

    if (cErr || !contribution) return error('Contribution not found', 404)
    if (contribution.status === 'paid') return error('This contribution has already been paid')

    const member    = contribution.members
    const reference = `CONT-${contribution_id}-${Date.now()}`
    const email     = member.email ?? `${member.phone.replace('+', '')}@susu.platform`

    const paystackRes = await initializeTransaction({
      email,
      amount:       Math.round(contribution.amount * 100),
      reference,
      callback_url: `${FRONTEND_URL}/member/payments?ref=${reference}`,
      metadata: {
        type:            'contribution',
        contribution_id: contribution_id,
        member_id:       session.sub,
        member_name:     member.full_name,
      },
    })

    if (!paystackRes.status) {
      return error('Could not initialize payment. Try again.', 500)
    }

    // Mark transaction as pending
    await supabaseAdmin.from('transactions').insert({
      member_id:   session.sub,
      type:        'contribution',
      amount:      contribution.amount,
      reference,
      description: `Susu contribution for ${contribution.due_date}`,
      status:      'pending',
      related_id:  contribution_id,
    })

    return json({
      authorization_url: paystackRes.data.authorization_url,
      reference:         paystackRes.data.reference,
      amount:            contribution.amount,
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
