import { handleCors, json, error } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST') return error('Method not allowed', 405, req)

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401, req)

  try {
    const { current_password, new_password } = await req.json()
    if (!current_password || !new_password) return error('Both passwords are required', 400, req)
    if (new_password.length < 10) return error('New password must be at least 10 characters', 400, req)

    const { data, error: e } = await supabaseAdmin.rpc('change_admin_password', {
      p_admin_id: admin.sub,
      p_current:  current_password,
      p_new:      new_password,
    })
    if (e) return error(e.message, 400, req)
    if (data !== true) return error('Current password is incorrect', 401, req)

    await supabaseAdmin.from('audit_log').insert({
      admin_id: admin.sub, admin_name: admin.full_name ?? admin.email,
      action: 'admin.password_changed', entity_type: 'admin', entity_id: admin.sub,
      entity_label: (admin.email as string) ?? '',
    })

    // Changing the password bumped token_version — this session is now dead too
    return json({ message: 'Password changed. Please sign in again.' }, 200, req)
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500, req)
  }
})
