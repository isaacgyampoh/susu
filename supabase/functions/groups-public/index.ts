import { handleCors, json, error } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const { data: groups, error: dbErr } = await supabaseAdmin
      .from('susu_groups')
      .select('id, name, description, contribution_amount, contribution_frequency, cycle_days, max_members, current_members, registration_fee, status, start_date, rules, image_url')
      .in('status', ['open', 'full', 'active'])
      .order('created_at', { ascending: true })

    if (dbErr) return error(dbErr.message, 500)

    return json({ groups })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
