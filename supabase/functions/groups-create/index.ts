import { handleCors, json, error } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'

Deno.serve(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  const url    = new URL(req.url)
  const method = req.method
  const id     = url.searchParams.get('id')

  try {
    // POST — create a new group
    if (method === 'POST') {
      const body = await req.json()
      const {
        name, description, contribution_amount, contribution_frequency,
        cycle_days, max_members, registration_fee, rules, start_date,
      } = body

      if (!name || !contribution_amount || !max_members) {
        return error('name, contribution_amount, and max_members are required')
      }

      const { data: group, error: dbErr } = await supabaseAdmin
        .from('susu_groups')
        .insert({
          name,
          description,
          contribution_amount: parseFloat(contribution_amount),
          contribution_frequency: contribution_frequency ?? 'daily',
          cycle_days:       parseInt(cycle_days ?? max_members),
          max_members:      parseInt(max_members),
          registration_fee: parseFloat(registration_fee ?? 0),
          rules,
          start_date:       start_date ?? null,
          status:           'open',
          created_by:       admin.sub,
        })
        .select()
        .single()

      if (dbErr) return error(dbErr.message, 500)
      return json({ group }, 201)
    }

    // PATCH ?id=xxx — update group details
    if (method === 'PATCH' && id) {
      const body = await req.json()
      const { data: group, error: dbErr } = await supabaseAdmin
        .from('susu_groups')
        .update(body)
        .eq('id', id)
        .select()
        .single()

      if (dbErr) return error(dbErr.message, 500)
      return json({ group })
    }

    // GET — list all groups (admin view with full details)
    if (method === 'GET') {
      const { data: groups, error: dbErr } = await supabaseAdmin
        .from('susu_groups')
        .select(`
          *,
          group_memberships(count),
          payouts(count)
        `)
        .order('created_at', { ascending: false })

      if (dbErr) return error(dbErr.message, 500)
      return json({ groups })
    }

    return error('Method not allowed', 405)
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
