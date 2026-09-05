import { refuseJoin, PUBLIC_JOINABLE } from '../_shared/group-join.ts'
import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { rateLimit, tooManyMessage } from '../_shared/rate-limit.ts'
import { devPaymentsAllowed } from '../_shared/mode.ts'
import { issueRegistrationToken, TOKEN_TTL_DAYS } from '../_shared/registration-token.ts'
import { sendSMS } from '../_shared/africas-talking.ts'
import { registrationPaymentUrl } from '../_shared/urls.ts'


/** Validate an uploaded image when present (absent files are fine). */
function checkImage(file: File | null, label: string): string | null {
  if (!file || typeof file === 'string' || file.size === 0) return null
  if (!file.type?.startsWith('image/')) return `${label} must be an image file`
  if (file.size > 5 * 1024 * 1024)      return `${label} must be under 5MB`
  return null
}

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST') return error('Method not allowed', 405)

  /*
   * ── RATE LIMIT ────────────────────────────────────────────────────────
   * This endpoint is public and needs no session, and each call writes an
   * application, performs nine storage operations and sends two SMS. Unlimited,
   * one caller in a loop fills the registration queue, fills the bucket and
   * runs up a real SMS bill.
   *
   * Six an hour per source: a genuine applicant submits once, and a household
   * or a shared connection sharing one address still has room to retry a failed
   * upload several times. Checked before the body is read, so a flood costs
   * nothing but the check.
   */
  const limit = await rateLimit(req, 'kyc-submit', 6, 60)
  if (!limit.allowed) {
    return error(tooManyMessage(limit.retryAfterSeconds, 'applications from this device'), 429)
  }

  try {
    const formData = await req.formData()

    const full_name         = formData.get('full_name') as string
    const phone             = formData.get('phone') as string
    const ghana_card_number = formData.get('ghana_card_number') as string

    // An applicant may select several groups at once. 'selected_group_ids'
    // is comma-separated; the old single 'selected_group_id' still works.
    // Preferred: selected_groups JSON [{ id, slots }]; legacy: comma ids
    const FRACS = [0.25, 0.5, 1]
    let slotMap: Record<string, { count: number; fraction: number }> = {}
    try {
      const rawSel = formData.get('selected_groups') as string | null
      if (rawSel) for (const g of JSON.parse(rawSel)) {
        if (g?.id) slotMap[g.id] = { count: Math.max(1, Math.min(10, Number(g.slots ?? 1))), fraction: FRACS.includes(Number(g.fraction)) ? Number(g.fraction) : 1 }
      }
    } catch (_) { /* fall through to ids */ }

    const rawIds = (formData.get('selected_group_ids') as string)
                ?? (formData.get('selected_group_id') as string) ?? ''
    const selectedGroupIds = Object.keys(slotMap).length > 0
      ? Object.keys(slotMap)
      : [...new Set(rawIds.split(',').map(s => s.trim()).filter(Boolean))]
    if (Object.keys(slotMap).length === 0) for (const id of selectedGroupIds) slotMap[id] = { count: 1, fraction: 1 }
    const selected_group_id = selectedGroupIds[0]

    if (!full_name || !phone || !ghana_card_number || selectedGroupIds.length === 0) {
      return error('full_name, phone, ghana_card_number and at least one selected group are required')
    }

    const normPhone = phone.trim().replace(/^0/, '+233').replace(/^\+?233/, '+233')

    // Check duplicate
    const { data: existing } = await supabaseAdmin
      .from('kyc_applications')
      .select('id, status')
      .eq('phone', normPhone)
      .neq('status', 'rejected')
      .maybeSingle()
    if (existing) return error('An application with this phone number already exists', 409)

    // Verify every selected group
    const { data: groupsData } = await supabaseAdmin
      .from('susu_groups')
      .select('id, name, registration_fee, status, current_members, max_members')
      .in('id', selectedGroupIds)

    if (!groupsData || groupsData.length !== selectedGroupIds.length) return error('One or more selected groups were not found', 404)
    for (const g of groupsData) {
      const want = slotMap[g.id]?.count ?? 1

      // Which of the two reasons it actually is — state, or capacity — is
      // decided in one place, shared with the admin door. See group-join.ts.
      const refusal = refuseJoin(
        { name: g.name, status: g.status, max_members: g.max_members, current_members: g.current_members },
        want, PUBLIC_JOINABLE,
      )
      if (refusal) return error(refusal, 400, req)
    }

    // Total registration fee: fee × slots, across all selected groups
    const totalFee = Math.round(groupsData.reduce((s, g) => s + Number(g.registration_fee || 0) * (slotMap[g.id]?.count ?? 1) * (slotMap[g.id]?.fraction ?? 1), 0) * 100) / 100
    const group = { registration_fee: totalFee }

    // Upload Ghana Card images
    let frontUrl: string | null = null
    let backUrl:  string | null = null
    const ts = Date.now()

    const frontFile = formData.get('ghana_card_front') as File | null
    const backFile  = formData.get('ghana_card_back')  as File | null

    for (const [file, label] of [[frontFile, 'Ghana Card front'], [backFile, 'Ghana Card back']] as const) {
      const bad = checkImage(file, label)
      if (bad) return error(bad, 400, req)
    }

    /*
     * ── GHANA CARD UPLOAD ────────────────────────────────────────────────
     *
     * This silently lost every card ever submitted. Two reasons, both hidden:
     *
     *   1. The `kyc-documents` bucket did not exist. The upload error was
     *      discarded — `const { data: up }` without `error` — so `up` came back
     *      null, the URL stayed null, and the application saved as though no
     *      card had been offered. 27 applications carry a card NUMBER and not
     *      one carries an image.
     *
     *   2. It stored `getPublicUrl(...)`, but the bucket is private by design
     *      ("looking at someone's national ID is a privileged act"). A public
     *      URL into a private bucket resolves to nothing, and admin-document —
     *      which signs a short-lived URL — expects a storage PATH and rejects
     *      anything not starting with `ghana-cards/`.
     *
     * The path is now stored, the error is surfaced, and a failed upload is
     * reported to the applicant instead of being swallowed. The card is part of
     * verification; losing it quietly is worse than refusing the form.
     */
    async function uploadCard(file: File, side: 'front' | 'back'): Promise<string> {
      const path = `ghana-cards/${crypto.randomUUID()}-${side}`
      const { data: up, error: upErr } = await supabaseAdmin.storage
        .from('kyc-documents')
        .upload(path, file, { contentType: file.type, upsert: false })
      if (upErr || !up) {
        console.error(`kyc-submit: ${side} card upload failed:`, upErr?.message)
        throw new Error(`Your Ghana Card ${side} image could not be uploaded. Please try again.`)
      }
      return up.path
    }

    try {
      if (frontFile) frontUrl = await uploadCard(frontFile, 'front')
      if (backFile)  backUrl  = await uploadCard(backFile, 'back')
    } catch (e) {
      return error((e as Error).message, 502, req)
    }

    // The applicant's payment link. Issued here — before the row exists — so
    // that an application is never created without a way to pay for it, which
    // is precisely how the 13 historical unpaid registrations happened.
    const link = await issueRegistrationToken()

    // Create KYC record
    const kycRow: Record<string, unknown> = ({
        full_name, phone: normPhone,
        email:               formData.get('email') as string | null,
        date_of_birth:       formData.get('date_of_birth') as string | null,
        occupation:          formData.get('occupation') as string | null,
        residential_address: formData.get('residential_address') as string | null,
        ghana_card_number, ghana_card_front_url: frontUrl, ghana_card_back_url: backUrl,
        selected_group_id,
        selected_group_ids: selectedGroupIds,
        selected_slots: slotMap,
        mobile_money_number:   formData.get('mobile_money_number') as string | null,
        mobile_money_provider: formData.get('mobile_money_provider') as string | null,
        bank_name:             formData.get('bank_name') as string | null,
        bank_account_number:   formData.get('bank_account_number') as string | null,
        bank_account_name:     formData.get('bank_account_name') as string | null,
        registration_fee_amount: group.registration_fee,
        // Only ever true without a real payment when dev mode is explicitly on
        registration_fee_paid: devPaymentsAllowed() || group.registration_fee === 0,
        status: 'pending',
        // Only the hash is stored. A reader of this table cannot reconstruct
        // any applicant's link.
        payment_token_hash:       link.hash,
        payment_token_issued_at:  new Date().toISOString(),
        payment_token_expires_at: link.expiresAt,
      })
    // ── One insert, no retries ───────────────────────────────────────────
    // This used to catch the insert, regex the error MESSAGE for a column
    // name, delete that field and try again — twice. It was written when the
    // v9 and v13 migrations might not have been applied yet. Both have been
    // applied for months, and every column below exists in production, so the
    // fallbacks could no longer fire for the reason they were written; they
    // could only fire on some UNRELATED failure that happened to mention
    // `selected_slots`, and then silently save an application missing the
    // slot counts the fee was calculated from. Schema is a deployment
    // guarantee, not something to discover from an error string at runtime.
    const { data: kyc, error: kycErr } = await supabaseAdmin
      .from('kyc_applications').insert(kycRow).select('id').single()
    if (kycErr || !kyc) {
      console.error('kyc-submit: insert failed', kycErr?.message)
      return error('Could not save your application. Please try again.', 500)
    }

    // ── The applicant can now pay, before approval ───────────────────────
    // Previously this returned "submitted" and stopped: NaloPay prompts a
    // phone, prompting needed an authenticated member, and an applicant is not
    // one — so the fee could only ever be recorded by an admin after the fact.
    // The payment link is a capability, not an account: it pays THIS
    // application's fee and does nothing else.
    const payUrl = registrationPaymentUrl(link.token)
    const feeDue = !devPaymentsAllowed() && group.registration_fee > 0

    if (feeDue) {
      // Sent as well as shown. An applicant who closes the tab has lost the
      // only copy of a token we deliberately cannot recover.
      await sendSMS(normPhone,
        `Hi ${full_name.split(' ')[0]}, your susu application is received. `
      + `Pay your GHS ${group.registration_fee.toFixed(2)} registration fee here (valid ${TOKEN_TTL_DAYS} days): ${payUrl}`)
        .catch(() => {})
    }

    return json({
      message:  'KYC application submitted successfully',
      kyc_id:   kyc.id,
      fee:      group.registration_fee,
      fee_paid: devPaymentsAllowed() || group.registration_fee === 0,
      // The raw token is returned exactly once, here. It is not stored and
      // cannot be re-derived; a lost link has to be re-issued by an admin.
      payment_url: feeDue ? payUrl : null,
      payment_link_expires_at: feeDue ? link.expiresAt : null,
    }, 201)
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
