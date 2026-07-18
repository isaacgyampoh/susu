import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'
import { sendSMS, smsTemplates }   from '../_shared/africas-talking.ts'

/*
 * Portal invites, sent when YOU are ready — e.g. once the payment system
 * is integrated. Each invite generates a FRESH passcode (hashes can't be
 * read back), stores it, stamps credentials_sent_at, and texts the member
 * their portal link, member ID and passcode. They can change the passcode
 * to their own PIN inside the portal afterwards.
 *
 * GET  → { total_active, uninvited }              (counts for the modal)
 * POST { scope: 'uninvited' | 'all' }             ('all' re-issues everyone)
 */

const MEMBER_URL = Deno.env.get('MEMBER_URL') ?? 'https://my.abbiewealthsusu.com'
const SIGNIN_URL = `${MEMBER_URL}/m/login`

const newPasscode = () => Math.floor(100000 + Math.random() * 900000).toString()

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  try {
    if (req.method === 'GET') {
      const { count: total } = await supabaseAdmin
        .from('members').select('*', { count: 'exact', head: true }).eq('status', 'active')
      const { count: uninvited, error: cErr } = await supabaseAdmin
        .from('members').select('*', { count: 'exact', head: true })
        .eq('status', 'active').is('credentials_sent_at', null)
      if (cErr) return error('Run the pending database migrations first (credentials_sent_at is missing).', 500)
      return json({ total_active: total ?? 0, uninvited: uninvited ?? 0 })
    }

    if (req.method !== 'POST') return error('Method not allowed', 405)
    const { scope } = await req.json()
    if (!['uninvited', 'all'].includes(scope)) return error("scope must be 'uninvited' or 'all'")

    let query = supabaseAdmin
      .from('members').select('id, member_id, full_name, phone').eq('status', 'active')
    if (scope === 'uninvited') query = query.is('credentials_sent_at', null)

    const { data: members, error: mErr } = await query
    if (mErr) return error(mErr.message, 500)
    if (!members || members.length === 0) return json({ message: 'No members to invite', sent: 0, failed: [] })

    let sent = 0
    const failed: { member: string; reason: string }[] = []

    for (const m of members) {
      try {
        const passcode = newPasscode()
        const { data: hash } = await supabaseAdmin.rpc('hash_passcode', { p_passcode: passcode })
        const { error: upErr } = await supabaseAdmin
          .from('members')
          .update({ passcode_hash: hash ?? passcode, credentials_sent_at: new Date().toISOString() })
          .eq('id', m.id)
        if (upErr) { failed.push({ member: m.full_name, reason: upErr.message }); continue }

        const ok = await sendSMS(m.phone, smsTemplates.welcome(m.full_name, m.member_id, passcode, SIGNIN_URL))
        if (ok) sent++
        else failed.push({ member: m.full_name, reason: 'SMS not delivered — check BMS credits/logs' })
      } catch (e) {
        failed.push({ member: m.full_name, reason: (e as Error).message })
      }
    }

    await supabaseAdmin.from('audit_log').insert({
      admin_id: admin.sub, admin_name: (admin as any).full_name ?? (admin as any).email,
      action: 'members.invites_sent', entity_type: 'member', entity_id: null,
      entity_label: `${sent} portal invite(s), scope: ${scope}`,
      details: { sent, failed: failed.length },
    })

    return json({
      message: `Sent ${sent} invite${sent === 1 ? '' : 's'}${failed.length ? `, ${failed.length} failed` : ''}`,
      sent, failed,
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
