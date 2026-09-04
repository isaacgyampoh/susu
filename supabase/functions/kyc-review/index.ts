import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { resolvePortion } from '../_shared/portions.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { generatePasscode, hashPasscode, passcodeErrorResponse } from '../_shared/passcode.ts'
import { requireAdmin }            from '../_shared/jwt.ts'
import { sendSMS, smsTemplates }   from '../_shared/africas-talking.ts'
import { issueRegistrationToken }  from '../_shared/registration-token.ts'
import { registrationPaymentUrl }  from '../_shared/urls.ts'

// The member portal is a different hostname from the console. Deriving it from
// FRONTEND_URL produced admin.abbiewealthsusu.com/m/login — a 404 in the
// member's hand, because middleware blocks /m/* on the admin host.
const MEMBER_URL = Deno.env.get('MEMBER_URL') ?? 'https://my.abbiewealthsusu.com'
const SIGNIN_URL = `${MEMBER_URL}/m/login`

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  // Support both GET (list KYC) and POST (review action)
  if (req.method === 'GET') {
    const admin = await requireAdmin(req)
    if (!admin) return error('Unauthorized', 401)
    const url    = new URL(req.url)
    const status = url.searchParams.get('status') ?? 'pending'

    // ── The registration queue ────────────────────────────────────────────
    // Buckets are derived in `get_registration_queue()`, not in the browser.
    // A console that computes "has this person paid?" from a list it fetched
    // can disagree with the database; one that asks the database cannot.
    if (url.searchParams.get('view') === 'queue') {
      const bucket = url.searchParams.get('bucket') ?? 'all'
      const valid = ['all', 'awaiting_payment', 'awaiting_review', 'approved', 'rejected']
      if (!valid.includes(bucket)) return error(`bucket must be one of: ${valid.join(', ')}`, 400)
      const { data, error: rpcErr } = await supabaseAdmin
        .rpc('get_registration_queue', { p_bucket: bucket })
      if (rpcErr) return error(rpcErr.message, 500)
      return json(data)
    }

    // ── Re-issue an applicant's payment link ──────────────────────────────
    // Tokens are stored hashed and cannot be recovered, so a lost link is
    // replaced rather than resent. The new one supersedes the old.
    if (url.searchParams.get('view') === 'reissue_link') {
      const kycId = url.searchParams.get('id')
      if (!kycId) return error('id is required', 400)
      const { data: k } = await supabaseAdmin
        .from('kyc_applications')
        .select('id, full_name, phone, status, registration_fee_paid, registration_fee_amount')
        .eq('id', kycId).maybeSingle()
      if (!k) return error('Application not found', 404)
      if (k.registration_fee_paid) return error('This fee is already paid', 400)
      if (k.status === 'rejected')  return error('This application was rejected', 400)
      if (Number(k.registration_fee_amount ?? 0) <= 0) return error('No fee is due', 400)

      const link = await issueRegistrationToken()
      await supabaseAdmin.from('kyc_applications').update({
        payment_token_hash: link.hash,
        payment_token_issued_at: new Date().toISOString(),
        payment_token_expires_at: link.expiresAt,
      }).eq('id', kycId)

      const payUrl = registrationPaymentUrl(link.token)
      await sendSMS(k.phone,
        `Hi ${k.full_name.split(' ')[0]}, pay your GHS ${Number(k.registration_fee_amount).toFixed(2)} `
      + `susu registration fee here: ${payUrl}`).catch(() => {})

      await supabaseAdmin.from('audit_log').insert({
        admin_id: admin.sub as string,
        admin_name: (admin.full_name as string) ?? (admin.email as string) ?? 'admin',
        action: 'registration.payment_link_reissued',
        entity_type: 'kyc_application', entity_id: kycId, entity_label: k.full_name,
        details: { expires_at: link.expiresAt, sent_to: k.phone },
      })
      // The token is returned once so the admin can pass it on directly if the
      // SMS does not arrive. It is not stored anywhere it can be read back.
      return json({ message: 'A new payment link has been sent by SMS.', payment_url: payUrl, expires_at: link.expiresAt })
    }

    let query = supabaseAdmin
      .from('kyc_applications')
      .select('*, susu_groups(id, name, registration_fee)')
      .order('submitted_at', { ascending: false })

    if (status !== 'all') query = query.eq('status', status)
    const { data, error: dbErr } = await query
    if (dbErr) return error(dbErr.message, 500)

    // Resolve names for multi-group selections
    const allIds = [...new Set((data ?? []).flatMap((a: any) => a.selected_group_ids ?? []))]
    let nameMap: Record<string, string> = {}
    if (allIds.length > 0) {
      const { data: gs } = await supabaseAdmin.from('susu_groups').select('id, name').in('id', allIds)
      nameMap = Object.fromEntries((gs ?? []).map((g: any) => [g.id, g.name]))
    }
    const enriched = (data ?? []).map((a: any) => ({
      ...a,
      selected_groups: (a.selected_group_ids ?? [a.selected_group_id]).filter(Boolean)
        .map((id: string) => ({
          id,
          name: nameMap[id] ?? a.susu_groups?.name ?? '—',
          slots: Math.max(1, Number(a.selected_slots?.[id]?.count ?? a.selected_slots?.[id] ?? 1)),
          fraction: Number(a.selected_slots?.[id]?.fraction ?? 1),
        })),
    }))
    return json(enriched)
  }

  if (req.method !== 'POST') return error('Method not allowed', 405)

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  try {
    const url    = new URL(req.url)
    const kycId  = url.searchParams.get('id')
    const body = await req.json()
    const { action, rejection_reason } = body

    if (!kycId) return error('KYC application ID required')
    if (!['approve', 'reject', 'mark_fee_paid'].includes(action)) return error('action must be approve, reject or mark_fee_paid')

    const { data: kyc } = await supabaseAdmin
      .from('kyc_applications')
      .select('*, susu_groups(id, name, max_members, current_members)')
      .eq('id', kycId)
      .single()

    if (!kyc) return error('KYC application not found', 404)
    if (kyc.status !== 'pending') return error('Application already reviewed')

    if (action === 'mark_fee_paid') {
      if (kyc.registration_fee_paid) return error('Registration fee is already marked paid', 400)

      const feeAmount = Number(kyc.registration_fee_amount ?? 0)

      // ── PHASE 07 ─────────────────────────────────────────────────────────
      // This used to flip `registration_fee_paid` first, and only then record
      // a transaction — and only if the applicant already had a member record.
      // For an applicant who did not, it wrote no transaction and no audit row
      // at all: a bare flag saying money arrived, with nothing anywhere saying
      // where from, how much, or who decided it.
      //
      // Seven production applications are in exactly that state, GHS 1,745
      // between them, all from 19–21 July. They are left alone — reversing a
      // fee flag on a live member on the strength of a missing record would be
      // guessing at payment status — but the path that produced them is closed:
      // the transaction and the audit row are now written FIRST, and the flag
      // only follows if they succeeded. Invariant 12 fails if this recurs.
      if (feeAmount <= 0) return error('This application has no fee due', 400)
      if (typeof body.reason !== 'string' || body.reason.trim().length < 10) {
        return error('Recording a fee received outside the app needs a reason of at least 10 characters — it is written to the audit log.', 400)
      }
      const reason = body.reason.trim()
      const ref = `REG-MANUAL-${String(kycId).slice(0, 8)}-${Date.now()}`

      const { error: txErr } = await supabaseAdmin.from('transactions').insert({
        member_id: kyc.created_member_id ?? null,
        kyc_application_id: kycId,
        type: 'registration_fee', amount: feeAmount, reference: ref, status: 'success',
        description: `Registration fee received outside the app — recorded by ${admin.full_name ?? admin.email}. ${reason}`,
      })
      if (txErr) return error(`Could not record the payment: ${txErr.message}`, 500)

      await supabaseAdmin.from('audit_log').insert({
        admin_id: admin.sub as string,
        admin_name: (admin.full_name as string) ?? (admin.email as string) ?? 'admin',
        action: 'registration.marked_fee_paid',
        entity_type: 'kyc_application', entity_id: kycId,
        entity_label: `${kyc.full_name} — GHS ${feeAmount.toFixed(2)}`,
        details: { reason, fee: feeAmount, reference: ref, recorded_outside_app: true },
      })

      await supabaseAdmin.from('kyc_applications')
        .update({ registration_fee_paid: true, registration_fee_ref: ref })
        .eq('id', kycId).eq('registration_fee_paid', false)

      await sendSMS(kyc.phone, `Hi ${kyc.full_name.split(' ')[0]}, we received your registration fee of GHS ${feeAmount.toLocaleString()}. Thank you!`)
      return json({ message: 'Registration fee recorded as received', reference: ref })
    }

    if (action === 'reject') {
      await supabaseAdmin.from('kyc_applications')
        .update({ status: 'rejected', rejection_reason, reviewer_id: admin.sub, reviewed_at: new Date().toISOString() })
        .eq('id', kycId)
      await sendSMS(kyc.phone, smsTemplates.applicationRejected(kyc.full_name, rejection_reason ?? 'Application did not meet requirements'))
      return json({ message: 'Application rejected' })
    }

    // ── REGISTRATION PAYMENT GATE ───────────────────────────────────────
    // A submitted form does not make someone a paid member. Approval — which
    // creates an ACTIVE member with live memberships, payout positions and a
    // contribution schedule — now requires the registration fee to have been
    // verified by the provider, OR an explicit, audited administrative
    // override.
    //
    // Production showed why: 13 approved applications carry an unpaid fee
    // totalling GHS 1,320.50, and five of them produced members who are still
    // active. Those records are preserved and left for a business decision;
    // this gate stops the count growing.
    //
    // The override never fabricates a payment. It records that a human
    // decided to activate without one, and who decided it.
    if (!kyc.registration_fee_paid && Number(kyc.registration_fee_amount ?? 0) > 0) {
      const reason = typeof body.override_reason === 'string' ? body.override_reason.trim() : ''
      if (!body.override_unpaid_fee) {
        return json({
          error: 'registration_fee_unpaid',
          message:
            `The registration fee of GHS ${Number(kyc.registration_fee_amount).toFixed(2)} has not been ` +
            `received. Approving now would activate a membership that has not been paid for.`,
          fee_due: Number(kyc.registration_fee_amount),
          how_to_proceed:
            'Either record the payment (action: mark_fee_paid) once it arrives, or approve with ' +
            'override_unpaid_fee: true and an override_reason, which is written to the audit log.',
        }, 402)
      }
      if (reason.length < 10) {
        return error('An override needs a reason of at least 10 characters — it is written to the audit log.', 400)
      }
      await supabaseAdmin.from('audit_log').insert({
        admin_id: admin.sub as string,
        admin_name: (admin.name as string) ?? 'admin',
        action: 'registration.approved_without_payment',
        entity_type: 'kyc_application',
        entity_id: kycId,
        entity_label: `${kyc.full_name} — GHS ${Number(kyc.registration_fee_amount).toFixed(2)} unpaid`,
        details: {
          reason,
          fee_due: Number(kyc.registration_fee_amount),
          note: 'Membership activated without a verified registration fee. No payment record was created.',
        },
      })
    }

    // APPROVE — the applicant may have chosen several groups
    const targetIds: string[] = (kyc.selected_group_ids && kyc.selected_group_ids.length > 0)
      ? kyc.selected_group_ids
      : [kyc.selected_group_id]

    const { data: targetGroups } = await supabaseAdmin
      .from('susu_groups').select('id, name, max_members, current_members, cashout_amount')
      .in('id', targetIds)

    // Payout dates chosen by the admin at approval time. Preferred shape is
    // per slot — body.payout_dates_slots = { "<group_id>": ["d1","d2",...] } —
    // with the older per-group shape kept as slot 1's date.
    const legacyDates: Record<string, string> = body.payout_dates ?? {}
    const slotDates: Record<string, string[]> = body.payout_dates_slots ?? {}
    const dateForSlot = (gid: string, i: number): string | null =>
      slotDates[gid]?.[i] || (i === 0 ? (legacyDates[gid] || null) : null)

    const slotWanted = (gid: string) => Math.max(1, Math.min(10, Number(kyc.selected_slots?.[gid]?.count ?? kyc.selected_slots?.[gid] ?? 1)))
    const fracWanted = (gid: string) => [0.25, 0.5, 1].includes(Number(kyc.selected_slots?.[gid]?.fraction)) ? Number(kyc.selected_slots[gid].fraction) : 1
    const openTargets = (targetGroups ?? []).filter(g => g.current_members + slotWanted(g.id) <= g.max_members)
    const fullTargets = (targetGroups ?? []).filter(g => g.current_members + slotWanted(g.id) > g.max_members)
    if (openTargets.length === 0) return error('All selected groups are now full', 400)

    // An applicant may already be a member (added manually, or applying for
    // MORE groups from the website). Reuse their account instead of tripping
    // the unique-phone constraint.
    const normPhone = String(kyc.phone ?? '').trim().replace(/^0/, '+233').replace(/^\+?233/, '+233')
    const { data: existingMember } = await supabaseAdmin
      .from('members').select('id, member_id, full_name, status')
      .in('phone', [kyc.phone, normPhone].filter(Boolean))
      .maybeSingle()

    let member: { id: string; member_id: string }
    let passcode: string | null = null

    if (existingMember) {
      if (existingMember.status !== 'active') {
        return error(`${existingMember.full_name} (${existingMember.member_id}) already exists but is ${existingMember.status}. Reactivate them on their member page, then approve.`, 409)
      }
      member = existingMember
    } else {
    passcode = generatePasscode()

    // Hash the passcode using Postgres
    const hashData = await hashPasscode(passcode)

    // Create member
    const { data: created, error: memErr } = await supabaseAdmin
      .from('members')
      .insert({
        full_name: kyc.full_name, phone: kyc.phone, email: kyc.email,
        whatsapp_number: kyc.mobile_money_number ?? kyc.phone,
        ghana_card_number: kyc.ghana_card_number,
        ghana_card_front_url: kyc.ghana_card_front_url,
        ghana_card_back_url:  kyc.ghana_card_back_url,
        passcode_hash: hashData,
        status: 'active',
        date_of_birth: kyc.date_of_birth, occupation: kyc.occupation,
        residential_address: kyc.residential_address,
        bank_name: kyc.bank_name, bank_account_number: kyc.bank_account_number,
        bank_account_name: kyc.bank_account_name,
        mobile_money_number: kyc.mobile_money_number,
        mobile_money_provider: kyc.mobile_money_provider,
      })
      .select('id, member_id')
      .single()

    if (memErr || !created) return error(memErr?.message ?? 'Could not create member', 500)
    member = created
    }

    // Assign next available payout position in each open group
    // `slot` is pushed below; the declaration omitted it.
    const assignments: { group: string; payout_position: number;
                         payout_date?: string | null; slot?: number; of_slots?: number }[] = []
    for (const g of openTargets) {
      const wanted = slotWanted(g.id)
      const { data: taken } = await supabaseAdmin
        .from('group_memberships').select('payout_position')
        .eq('group_id', g.id)
      const used = new Set((taken ?? []).map((r: any) => r.payout_position))

      const fraction = fracWanted(g.id)
      // The fifth and last place that multiplied by fraction. Approving a KYC
      // application creates real memberships, so it has to price them the same
      // way every other join path now does.
      const portion = await resolvePortion(g.id, fraction, g)
      const payoutAmount = portion.payout_amount
      for (let i = 0; i < wanted; i++) {
        let nextPosition = 1
        while (used.has(nextPosition)) nextPosition++
        used.add(nextPosition)

        const payoutDate = dateForSlot(g.id, i)

        const gmRow: Record<string, unknown> = {
          member_id: member.id, group_id: g.id,
          payout_position: nextPosition, status: 'active',
          payout_date: payoutDate, payout_amount: payoutAmount,
          slot_fraction: fraction, portion_id: portion.id,
        }
        // A concurrent approval into the same group can pick the same position
        // between our read of `used` and this insert. UNIQUE(group_id,
        // payout_position) then rejects it — and the failure used to be
        // swallowed, so the membership silently vanished while the applicant
        // was told they had been approved. Retry on the collision, then fail
        // loudly rather than continue with a membership that does not exist.
        let gm: { id: string } | null = null
        for (let attempt = 0; attempt < 5 && !gm; attempt++) {
          const { data, error: gmE } = await supabaseAdmin
            .from('group_memberships').insert(gmRow).select('id').single()
          if (data) { gm = data; break }
          const isPositionClash = gmE?.code === '23505' || /payout_position/.test(gmE?.message ?? '')
          if (!isPositionClash) {
            return error(`Approved, but assigning a slot in "${g.name}" failed: ${gmE?.message}`, 500)
          }
          // Someone took it first. Re-read the group's live positions and try again.
          const { data: retaken } = await supabaseAdmin
            .from('group_memberships').select('payout_position').eq('group_id', g.id)
          const takenNow = new Set((retaken ?? []).map((r: any) => r.payout_position))
          let p = 1
          while (takenNow.has(p)) p++
          gmRow.payout_position = p
          nextPosition = p
          used.add(p)
        }
        if (!gm) {
          return error(`Could not find a free payout position in "${g.name}" after 5 attempts. Try again.`, 409)
        }

        if (payoutDate && gm) {
          await supabaseAdmin.from('payouts').insert({
            member_id: member.id, group_id: g.id, membership_id: gm.id,
            total_amount: payoutAmount, scheduled_date: payoutDate,
            status: 'upcoming', notes: 'Scheduled at KYC approval',
          })
        }
        // Joining a RUNNING group: give this slot its payment schedule
        if (gm?.id) await supabaseAdmin.rpc('generate_membership_schedule', { p_membership_id: gm.id })
          .then(({ error: sErr }) => { if (sErr) console.log('schedule gen skipped:', sErr.message) })

        assignments.push({ group: g.name, payout_position: nextPosition, payout_date: payoutDate, slot: i + 1, of_slots: wanted })
      }
    }

    // Update KYC
    await supabaseAdmin.from('kyc_applications')
      .update({ status: 'approved', reviewer_id: admin.sub, reviewed_at: new Date().toISOString(), created_member_id: member.id })
      .eq('id', kycId)

    // Send welcome SMS (skipped silently if no AT key)
    const sendCreds = body.send_credentials !== false
    if (sendCreds) {
      if (passcode) {
        await sendSMS(kyc.phone, smsTemplates.applicationApproved(kyc.full_name, member.member_id, passcode, SIGNIN_URL))
      } else {
        const names = assignments.map(a => a.group).filter((v, i, arr) => arr.indexOf(v) === i).join(', ')
        await sendSMS(kyc.phone, `Hi ${kyc.full_name.split(' ')[0]}, your application is approved — you've been added to ${names}. Sign in as usual: ${SIGNIN_URL}`)
      }
      if (passcode) await supabaseAdmin.from('members')
        .update({ credentials_sent_at: new Date().toISOString() })
        .eq('id', member.id)
        .then(({ error: e }) => { if (e) console.log('credentials_sent_at skipped:', e.message) })
    }

    return json({
      message:    sendCreds ? 'Member approved and credentials sent via SMS' : 'Member approved — credentials NOT sent (held for bulk invite)',
      member_id:  member.member_id,
      existing_member: !passcode,
      passcode,   // also returned in response so admin can share manually if no SMS
      portal_url: SIGNIN_URL,
      assignments,
      skipped_full_groups: fullTargets.map(g => g.name),
    })
  } catch (e) {
    // A passcode that could not be hashed must abort the whole approval —
    // never fall through to writing the member with an unusable credential.
    const pc = passcodeErrorResponse(e, error)
    if (pc) return pc
    console.error(e)
    return error('Internal server error', 500)
  }
})
