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
    if (method === 'POST') {
      const body = await req.json()
      const {
        name, description, contribution_amount, contribution_frequency,
        cycle_days, max_members, registration_fee, cashout_amount,
        payment_deadline, penalty_per_late_day, rules, admin_notes,
      } = body

      if (!name || !contribution_amount || !max_members || !cycle_days) {
        return error('name, contribution_amount, max_members, cycle_days are required')
      }

      const { data: group, error: dbErr } = await supabaseAdmin
        .from('susu_groups')
        .insert({
          name, description,
          contribution_amount:   parseFloat(contribution_amount),
          contribution_frequency: contribution_frequency ?? 'daily',
          cycle_days:            parseInt(cycle_days),
          max_members:           parseInt(max_members),
          registration_fee:      parseFloat(registration_fee ?? 0),
          cashout_amount:        cashout_amount ? parseFloat(cashout_amount) : null,
          payment_deadline:      payment_deadline ?? '18:00:00',
          penalty_per_late_day:  parseFloat(penalty_per_late_day ?? 0),
          rules, admin_notes,
          status:                'open',
          created_by:            admin.sub,
        })
        .select()
        .single()

      if (dbErr) return error(dbErr.message, 500)
      return json({ group }, 201)
    }

    if (method === 'PATCH' && id) {
      const body = await req.json()
      const { data: group, error: dbErr } = await supabaseAdmin
        .from('susu_groups').update(body).eq('id', id).select().single()
      if (dbErr) return error(dbErr.message, 500)
      return json({ group })
    }

    if (method === 'GET') {
      let query = supabaseAdmin.from('susu_groups')
        .select('*, group_memberships(count)')
        .order('created_at', { ascending: false })

      if (id) query = supabaseAdmin.from('susu_groups').select('*, group_memberships(*)').eq('id', id)

      const { data, error: dbErr } = await query
      if (dbErr) return error(dbErr.message, 500)
      return json(id ? { group: data } : { groups: data })
    }

    return error('Method not allowed', 405)
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
