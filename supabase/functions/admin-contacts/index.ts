import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  const url    = new URL(req.url)
  const method = req.method

  try {
    if (method === 'GET') {
      const { data, error: dbErr } = await supabaseAdmin
        .from('contact_messages')
        .select('*, members(member_id, full_name, phone)')
        .order('created_at', { ascending: false })
      if (dbErr) return error(dbErr.message, 500)
      return json({ messages: data })
    }

    if (method === 'PATCH') {
      const id = url.searchParams.get('id')
      const { reply_text } = await req.json()
      if (!id) return error('id required')

      await supabaseAdmin
        .from('contact_messages')
        .update({ reply_text, is_read: true, replied_at: new Date().toISOString() })
        .eq('id', id)

      return json({ message: 'Reply saved' })
    }

    return error('Method not allowed', 405)
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
