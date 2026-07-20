import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  try {
    const { data: groups, error: dbErr } = await supabaseAdmin
      .from('susu_groups')
      /*
       * An explicit allowlist, deliberately — this endpoint is public and
       * unauthenticated, and select('*') would hand out admin_notes.
       *
       * It also has to be MAINTAINED. cashout_amount, payment_deadline and
       * penalty_per_late_day were added to the table later and never added
       * here, so the website received cashout_amount: undefined and fell back
       * to computing a figure. That is why members were shown a number nobody
       * had decided. Anything the site needs must be listed.
       */
      .select([
        'id', 'name', 'description',
        'contribution_amount', 'contribution_frequency', 'cycle_days',
        'max_members', 'current_members',
        'registration_fee',
        'cashout_amount',          // what the member is actually paid
        'payment_deadline',        // shown on the card and the join page
        'penalty_per_late_day',    // shown in the rules
        'status', 'start_date', 'rules', 'image_url',
      ].join(', '))
      .in('status', ['open', 'full', 'active'])
      .neq('show_on_website', false)   // admin's visibility toggle (v19)
      // No decided payout, no listing. A group whose cashout has not been set
      // is not finished, and anything shown for it would be a guess.
      .not('cashout_amount', 'is', null)
      .order('created_at', { ascending: true })

    if (dbErr && /show_on_website/.test(dbErr.message)) {
      // v19 not applied yet — list without the toggle
      const retry = await supabaseAdmin
        .from('susu_groups')
        .select('id, name, description, contribution_amount, contribution_frequency, cycle_days, max_members, current_members, registration_fee, cashout_amount, payment_deadline, penalty_per_late_day, status, start_date, rules, image_url')
        .in('status', ['open', 'full', 'active'])
        .not('cashout_amount', 'is', null)
        .order('created_at', { ascending: true })
      if (retry.error) return error(retry.error.message, 500)
      return json({ groups: (retry.data ?? []).filter((g: any) => g.current_members < g.max_members) })
    }
    if (dbErr) return error(dbErr.message, 500)

    // A group with no spots left leaves the website automatically
    return json({ groups: (groups ?? []).filter((g: any) => g.current_members < g.max_members) })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
