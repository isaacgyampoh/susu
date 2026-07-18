import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'
import { sendSMS, smsTemplates }   from '../_shared/africas-talking.ts'

// Member portal, not the console — see kyc-review for why.
const MEMBER_URL = Deno.env.get('MEMBER_URL') ?? 'https://my.abbiewealthsusu.com'
const SIGNIN_URL = `${MEMBER_URL}/m/login`

function generatePasscode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString()
}

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST') return error('Method not allowed', 405)

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  try {
    const formData = await req.formData()

    const full_name         = formData.get('full_name') as string
    const phone             = formData.get('phone') as string
    const ghana_card_number = formData.get('ghana_card_number') as string

    // Multi-group: 'group_ids' is a comma-separated list. The old single
    // 'group_id' field is still honoured so nothing existing breaks.
    const groupIdsRaw = (formData.get('group_ids') as string) || (formData.get('group_id') as string) || ''
    const groupIds    = groupIdsRaw.split(',').map(s => s.trim()).filter(Boolean)

    if (!full_name || !phone || !ghana_card_number) {
      return error('full_name, phone, and ghana_card_number are required')
    }

    const normPhone = phone.trim().replace(/^0/, '+233').replace(/^\+?233/, '+233')

    // Duplicate check
    const { data: existing } = await supabaseAdmin
      .from('members').select('id, member_id, full_name')
      .eq('phone', normPhone).maybeSingle()
    if (existing) return error(`A member with this phone already exists: ${existing.member_id} (${existing.full_name})`, 409)

    // Upload Ghana Card if provided
    let frontUrl: string | null = null
    let backUrl:  string | null = null
    const ts = Date.now()

    const frontFile = formData.get('ghana_card_front') as File | null
    const backFile  = formData.get('ghana_card_back')  as File | null

    const MAX_BYTES = 5 * 1024 * 1024
    const ALLOWED   = ['image/jpeg','image/png','image/webp','image/heic','image/heif']
    for (const [file, label] of [[frontFile, 'Ghana Card front'], [backFile, 'Ghana Card back']] as const) {
      if (!file || file.size === 0) continue
      if (file.size > MAX_BYTES) return error(`${label} is larger than 5MB`, 400)
      if (!ALLOWED.includes(file.type)) return error(`${label} must be a photo`, 400)
    }

    if (frontFile && frontFile.size > 0) {
      const { data: up } = await supabaseAdmin.storage
        .from('kyc-documents')
        .upload(`ghana-cards/${crypto.randomUUID()}-front`, frontFile, { contentType: frontFile.type, upsert: false })
      if (up) frontUrl = up.path
    }
    if (backFile && backFile.size > 0) {
      const { data: up } = await supabaseAdmin.storage
        .from('kyc-documents')
        .upload(`ghana-cards/${crypto.randomUUID()}-back`, backFile, { contentType: backFile.type, upsert: false })
      if (up) backUrl = up.path
    }

    // Generate + hash passcode
    const passcode = generatePasscode()
    const { data: hashData } = await supabaseAdmin.rpc('hash_passcode', { p_passcode: passcode })

    // Create member
    const { data: member, error: memErr } = await supabaseAdmin
      .from('members')
      .insert({
        full_name, phone: normPhone,
        email:                 (formData.get('email') as string) || null,
        whatsapp_number:       (formData.get('whatsapp_number') as string) || normPhone,
        ghana_card_number,
        ghana_card_front_url:  frontUrl,
        ghana_card_back_url:   backUrl,
        passcode_hash:         hashData ?? passcode,
        status:                'active',
        date_of_birth:         (formData.get('date_of_birth') as string) || null,
        occupation:            (formData.get('occupation') as string) || null,
        residential_address:   (formData.get('residential_address') as string) || null,
        bank_name:             (formData.get('bank_name') as string) || null,
        bank_account_number:   (formData.get('bank_account_number') as string) || null,
        bank_account_name:     (formData.get('bank_account_name') as string) || null,
        mobile_money_number:   (formData.get('mobile_money_number') as string) || null,
        mobile_money_provider: (formData.get('mobile_money_provider') as string) || null,
      })
      .select('id, member_id, full_name, phone')
      .single()

    if (memErr) return error(memErr.message, 500)

    // Assign to one or more groups if provided
    const assignments: { group_id: string; group_name: string; payout_position: number }[] = []
    const feePaid = formData.get('registration_fee_paid') === 'true'

    for (const gid of groupIds) {
      const { data: group } = await supabaseAdmin
        .from('susu_groups').select('id, name, max_members, current_members, status, registration_fee')
        .eq('id', gid).single()
      if (!group) continue

      if (group.current_members >= group.max_members) {
        return error(`Group "${group.name}" is full (${group.current_members}/${group.max_members})`, 400)
      }

      const { data: slots } = await supabaseAdmin
        .from('group_memberships').select('payout_position')
        .eq('group_id', gid)
        .order('payout_position', { ascending: false }).limit(1)

      const position = (slots?.[0]?.payout_position ?? 0) + 1

      const { error: gmErr } = await supabaseAdmin.from('group_memberships').insert({
        member_id: member.id, group_id: gid,
        payout_position: position, status: 'active',
      })
      if (gmErr) return error(`Member created but assignment to "${group.name}" failed: ${gmErr.message}`, 500)

      assignments.push({ group_id: gid, group_name: group.name, payout_position: position })

      // Record registration fee as a transaction if group has one
      if (group.registration_fee > 0 && feePaid) {
        await supabaseAdmin.from('transactions').insert({
          member_id: member.id, type: 'registration_fee',
          amount: group.registration_fee,
          reference: `REG-${member.id}-${gid.slice(0, 8)}-${ts}`,
          description: `Registration fee for "${group.name}" (recorded by admin)`,
          status: 'success',
        })
      }
    }

    const assignedPosition = assignments[0]?.payout_position ?? null

    // Send welcome SMS (silently skipped if no AT key)
    await sendSMS(normPhone, smsTemplates.welcome(full_name, member.member_id, passcode, SIGNIN_URL))

    return json({
      message:   'Member created successfully',
      member: {
        id:        member.id,
        member_id: member.member_id,
        full_name: member.full_name,
        phone:     member.phone,
      },
      passcode,
      payout_position: assignedPosition,   // kept for old clients
      assignments,                          // one entry per group joined
      portal_url: SIGNIN_URL,
    }, 201)
  } catch (e) {
    console.error(e)
    return error('Internal server error: ' + (e as Error).message, 500)
  }
})
