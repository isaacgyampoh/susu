import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { signJWT }                 from '../_shared/jwt.ts'

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (req.method !== 'POST') return error('Method not allowed', 405)

  try {
    const { email, password } = await req.json()

    if (!email || !password) return error('Email and password are required')

    const ident = email.toLowerCase().trim()
    const { data: gate } = await supabaseAdmin.rpc('check_login_allowed', {
      p_identifier: ident, p_kind: 'admin',
    })
    if (gate?.[0] && !gate[0].allowed) {
      const mins = Math.ceil((gate[0].retry_after_seconds ?? 900) / 60)
      return error(`Too many failed attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`, 429)
    }

    const { data, error: dbErr } = await supabaseAdmin.rpc('verify_admin_password', {
      p_email: email.toLowerCase().trim(),
      p_password: password,
    })

    if (dbErr || !data || data.length === 0) {
      await supabaseAdmin.rpc('record_login_attempt', { p_identifier: ident, p_kind: 'admin', p_ok: false })
      return error('Invalid email or password', 401)
    }

    await supabaseAdmin.rpc('record_login_attempt', { p_identifier: ident, p_kind: 'admin', p_ok: true })

    const admin = data[0]
    const token = await signJWT({
      sub:       admin.id,
      email:     admin.email,
      full_name: admin.full_name,
      role:      admin.role,
      tv:        admin.token_version ?? 0,
      type:      'admin',
    })

    return json({
      token,
      admin: {
        id: admin.id, email: admin.email, full_name: admin.full_name, role: admin.role,
        must_change_password: admin.must_change_password ?? false,
      },
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
