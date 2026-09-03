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
        'status', 'start_date', 'end_date', 'rules', 'image_url',
        // Whether joining is immediate or goes to the collector for a decision.
        'requires_approval',
        /*
         * The portions this group offers, with the amounts as CONFIGURED. A
         * member choosing a half slot has to see what a half slot actually
         * costs and collects in THIS group — not a proportion the browser works
         * out, which is exactly what the old ¼ / ½ / Full chips did.
         *
         * Embedded rather than fetched per card: a page listing twenty groups
         * would otherwise make twenty more requests.
         */
        'group_portions(id, label, fraction, contribution_amount, payout_amount, registration_fee, sort_order)',
      ].join(', '))
      .in('status', ['open', 'full', 'active'])
      .neq('show_on_website', false)   // admin's visibility toggle (v19)
      // No decided payout, no listing. A group whose cashout has not been set
      // is not finished, and anything shown for it would be a guess.
      .not('cashout_amount', 'is', null)
      .order('created_at', { ascending: true })

    if (dbErr) return error(dbErr.message, 500)

    // A group with no spots left leaves the website automatically
    return json({ groups: (groups ?? []).filter((g: any) => g.current_members < g.max_members) })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
