import { handleCors, json, error } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { signJWT }                 from '../_shared/jwt.ts'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  if (req.method !== 'POST') return error('Method not allowed', 405)

  try {
    const { email, password } = await req.json()

    if (!email || !password) return error('Email and password are required')

    const { data, error: dbErr } = await supabaseAdmin.rpc('verify_admin_password', {
      p_email: email.toLowerCase().trim(),
      p_password: password,
    })

    if (dbErr || !data || data.length === 0) {
      return error('Invalid email or password', 401)
    }

    const admin = data[0]
    const token = await signJWT({
      sub:       admin.id,
      email:     admin.email,
      full_name: admin.full_name,
      role:      admin.role,
      type:      'admin',
    })

    return json({ token, admin: { id: admin.id, email: admin.email, full_name: admin.full_name, role: admin.role } })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
