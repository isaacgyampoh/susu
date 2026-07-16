import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'
import { sendSMS }                 from '../_shared/africas-talking.ts'

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const url    = new URL(req.url)
  const method = req.method

  try {
    // GET — public/member list
    if (method === 'GET') {
      const group_id = url.searchParams.get('group_id')
      let query = supabaseAdmin
        .from('announcements')
        .select('id, title, content, is_global, created_at, susu_groups(name)')
        .order('created_at', { ascending: false })
        .limit(20)

      if (group_id) {
        query = query.or(`is_global.eq.true,group_id.eq.${group_id}`)
      } else {
        query = query.eq('is_global', true)
      }

      const { data, error: dbErr } = await query
      if (dbErr) return error(dbErr.message, 500)
      return json({ announcements: data })
    }

    // Admin-only below
    const admin = await requireAdmin(req)
    if (!admin) return error('Unauthorized', 401)

    // POST — create announcement + optional SMS blast
    if (method === 'POST') {
      const { title, content, group_id, is_global, send_sms } = await req.json()
      if (!title || !content) return error('title and content are required')

      const { data: announcement, error: dbErr } = await supabaseAdmin
        .from('announcements')
        .insert({ title, content, group_id: group_id ?? null, is_global: !!is_global, created_by: admin.sub })
        .select()
        .single()

      if (dbErr) return error(dbErr.message, 500)

      // Optional SMS blast to relevant members
      if (send_sms) {
        let memberQuery = supabaseAdmin.from('members').select('phone').eq('status', 'active')

        if (group_id && !is_global) {
          const { data: memberships } = await supabaseAdmin
            .from('group_memberships').select('member_id').eq('group_id', group_id)
          const ids = memberships?.map((m: { member_id: string }) => m.member_id) ?? []
          memberQuery = supabaseAdmin.from('members').select('phone').in('id', ids).eq('status', 'active')
        }

        const { data: members } = await memberQuery
        const phones = members?.map((m: { phone: string }) => m.phone) ?? []

        // Send in batches of 10
        for (let i = 0; i < phones.length; i += 10) {
          const batch = phones.slice(i, i + 10)
          await sendSMS(batch, `[Susu Update] ${title}: ${content.slice(0, 120)}`)
        }
      }

      return json({ announcement }, 201)
    }

    return error('Method not allowed', 405)
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
