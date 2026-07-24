import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'

/*
 * The SMS record. Every message the system sends is logged, so "I never got a
 * message" can be checked instead of argued about.
 *
 * Search accepts a name or a phone number: names are resolved to the member's
 * numbers first, since the log stores whoever was texted, not who they are.
 *
 *   ?q=            name or phone
 *   ?range=today|7d|30d|all
 *   ?status=all|sent|failed
 *   ?page=1
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  try {
    const url    = new URL(req.url)
    const q      = (url.searchParams.get('q') ?? '').trim()
    const range  = url.searchParams.get('range') ?? '7d'
    const status = url.searchParams.get('status') ?? 'all'
    const page   = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
    const size   = 100

    const now = new Date()
    let since: string | null = null
    if (range === 'today') since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
    else if (range === '7d')  since = new Date(now.getTime() - 7 * 864e5).toISOString()
    else if (range === '30d') since = new Date(now.getTime() - 30 * 864e5).toISOString()

    let query = supabaseAdmin
      .from('sms_log')
      .select('id, recipient, message, ok, provider, error, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
    if (since) query = query.gte('created_at', since)
    if (status === 'sent')   query = query.eq('ok', true)
    if (status === 'failed') query = query.eq('ok', false)

    // A name has to become phone numbers before the log can be searched
    if (q) {
      const digits = q.replace(/\D/g, '')
      if (digits.length >= 6) {
        query = query.ilike('recipient', `%${digits.slice(-9)}%`)
      } else {
        const { data: people } = await supabaseAdmin
          .from('members').select('phone, mobile_money_number')
          .ilike('full_name', `%${q}%`).limit(50)
        const numbers = [...new Set((people ?? [])
          .flatMap((m: any) => [m.phone, m.mobile_money_number])
          .filter(Boolean)
          .map((n: string) => n.replace(/\D/g, '').slice(-9)))]
        if (numbers.length === 0) {
          return json({ messages: [], page, has_more: false, total: 0, summary: { sent: 0, failed: 0 } })
        }
        query = query.or(numbers.map(n => `recipient.ilike.%${n}%`).join(','))
      }
    }

    const { data, count, error: dbErr } = await query.range((page - 1) * size, page * size - 1)
    if (dbErr) {
      if (/sms_log/i.test(dbErr.message)) {
        return json({ messages: [], page, has_more: false, total: 0,
          summary: { sent: 0, failed: 0 },
          notice: 'The SMS log table does not exist yet — run migration v23.' })
      }
      return error(dbErr.message, 500)
    }

    // Attach a member name where the number is recognised
    const nums = [...new Set((data ?? []).map((r: any) => r.recipient.replace(/\D/g, '').slice(-9)))]
    const nameByNum = new Map<string, string>()
    if (nums.length) {
      const { data: people } = await supabaseAdmin
        .from('members').select('full_name, member_id, phone, mobile_money_number').limit(2000)
      for (const p of people ?? []) {
        for (const n of [p.phone, p.mobile_money_number].filter(Boolean)) {
          nameByNum.set(String(n).replace(/\D/g, '').slice(-9), `${p.full_name} (${p.member_id})`)
        }
      }
    }

    const messages = (data ?? []).map((r: any) => ({
      ...r,
      who: nameByNum.get(r.recipient.replace(/\D/g, '').slice(-9)) ?? null,
    }))

    let totalsQ = supabaseAdmin.from('sms_log').select('ok')
    if (since) totalsQ = totalsQ.gte('created_at', since)
    const { data: totals } = await totalsQ
    const sent   = (totals ?? []).filter((t: any) => t.ok).length
    const failed = (totals ?? []).length - sent

    return json({
      messages, page, total: count ?? 0,
      has_more: (count ?? 0) > page * size,
      summary: { sent, failed },
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
