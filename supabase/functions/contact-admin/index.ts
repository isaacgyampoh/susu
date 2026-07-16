import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireMember }           from '../_shared/jwt.ts'

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (req.method !== 'POST') return error('Method not allowed', 405)

  const session = await requireMember(req)
  if (!session) return error('Unauthorized', 401)

  try {
    const { subject, message } = await req.json()
    if (!subject || !message) return error('subject and message are required')

    const { data, error: dbErr } = await supabaseAdmin
      .from('contact_messages')
      .insert({ member_id: session.sub, subject, message })
      .select('id, created_at')
      .single()

    if (dbErr) return error(dbErr.message, 500)
    return json({ message: 'Message sent. The admin will respond shortly.', id: data.id }, 201)
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
