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
      // No decided payout, no listing. A group whose cashout has not been set
      // is not finished, and anything shown for it would be a guess.
      .not('cashout_amount', 'is', null)
      .order('created_at', { ascending: true })

    if (dbErr) return error(dbErr.message, 500)

    return json({ groups })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
