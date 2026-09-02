import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireMember }           from '../_shared/jwt.ts'

/**
 * Everything the member portal renders.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Rebuilt in Phase 04 around get_member_portal_state(), a single database
 * query that returns every active membership with its own complete financial
 * position.
 *
 * What it replaces, and why:
 *
 *   N+1. The old version issued six fixed queries plus two more per
 *   membership. The member who holds 30 memberships across 18 groups therefore
 *   cost 66 round trips to open one screen — over a mobile connection, to an
 *   edge function in another region.
 *
 *   TRUNCATED TOTALS. "Paid so far" was the sum of a 50-row window and "Still
 *   to pay" a 30-row window. Past those limits the figures simply stopped
 *   growing. For a member in 18 groups, 50 rows is under two days each; the
 *   number a member read as their lifetime contribution had been wrong for a
 *   long time. The projection aggregates in the database over every row.
 *
 *   A SILENT FALLBACK. On any RPC error the old code quietly switched from a
 *   per-slot balance to a per-member-and-group one — a different number, with
 *   nothing on screen to say which was being shown. Errors now surface.
 *
 * The response is membership-first by construction. There is no "current
 * group" and no plans[0]: every membership is returned with its own
 * obligations, coverage, credit and payout, and the portal renders all of them.
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const session = await requireMember(req)
  if (!session) return error('Unauthorized', 401)

  try {
    const memberId = session.sub as string
    const asOf = new Date().toISOString().slice(0, 10)   // Ghana is UTC+0

    // ── The whole portal, in one query. ──────────────────────────────────
    const { data: state, error: sErr } = await supabaseAdmin
      .rpc('get_member_portal_state', { p_member_id: memberId, p_as_of: asOf })
    if (sErr)  return error(`Could not load your account: ${sErr.message}`, 500)
    if (!state) return error('Member not found', 404)

    const s = state as Record<string, any>

    // ── Payment history, with what each payment actually covered. ────────
    // Grouped by reference so one MoMo debit reads as one payment with its
    // allocation breakdown, rather than as N unexplained lines.
    const { data: allocs } = await supabaseAdmin
      .from('payment_allocations')
      .select('reference, group_name, membership_id, due_date, amount, kind, created_at')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false })
      .limit(200)

    const byRef = new Map<string, {
      reference: string; at: string; total: number
      items: { group: string; membership_id: string; due_date: string; amount: number; kind: string }[]
    }>()
    for (const a of allocs ?? []) {
      let g = byRef.get(a.reference)
      if (!g) { g = { reference: a.reference, at: a.created_at, total: 0, items: [] }; byRef.set(a.reference, g) }
      g.total += Number(a.amount)
      g.items.push({
        group: a.group_name, membership_id: a.membership_id,
        due_date: a.due_date, amount: Number(a.amount), kind: a.kind,
      })
    }
    const payments = Array.from(byRef.values()).slice(0, 30)

    // ── Announcements and messages — small, bounded, unchanged. ──────────
    const groupIds = (s.memberships ?? []).map((m: any) => m.group_id).filter(Boolean)
    const annQuery = supabaseAdmin
      .from('announcements')
      .select('id, title, content, created_at, susu_groups(name)')
      .order('created_at', { ascending: false }).limit(10)
    const { data: announcements } = groupIds.length
      ? await annQuery.or(`is_global.eq.true,group_id.in.(${groupIds.join(',')})`)
      : await annQuery.eq('is_global', true)

    const { data: myMessages } = await supabaseAdmin
      .from('contact_messages')
      .select('id, subject, message, is_read, reply_text, replied_at, created_at')
      .eq('member_id', memberId)
      .order('created_at', { ascending: false }).limit(10)

    const { data: penalties } = await supabaseAdmin
      .from('payment_penalties')
      .select('id, amount, reason, is_paid, created_at, susu_groups(name)')
      .eq('member_id', memberId).eq('is_paid', false)

    /*
     * Payouts the member has actually collected.
     *
     * The profile screen has always shown a "Collected" section, and this
     * endpoint stopped returning `payouts` when it was rebuilt on
     * get_member_portal_state() — so the page read `undefined` and threw. The
     * membership rows carry `payout_received` and `payout_amount`, but not
     * WHEN it was paid, which is the part a member actually wants to see.
     *
     * Scoped to the caller, like everything else here: `memberId` comes from
     * the verified session, never from the request.
     */
    const { data: payouts } = await supabaseAdmin
      .from('payouts')
      .select('id, total_amount, status, scheduled_date, paid_at, susu_groups(name)')
      .eq('member_id', memberId)
      .order('paid_at', { ascending: false, nullsFirst: false })
      .limit(50)

    /*
     * The profile screen shows details the portal-state projection does not
     * carry — email, occupation, address, and when they joined. Those live on
     * `members` and are the member's own, so they are fetched here and merged
     * rather than widened into get_member_portal_state(), which every screen
     * calls and most of which do not need them.
     *
     * The profile page read all four straight off `member` and got undefined;
     * `format(new Date(undefined))` throws RangeError, which is one of the
     * things that made the page crash rather than merely look empty.
     */
    const { data: detail } = await supabaseAdmin
      .from('members')
      .select('email, occupation, residential_address, created_at, whatsapp_number')
      .eq('id', memberId)
      .maybeSingle()

    return json({
      as_of: s.as_of,
      member: { ...(s.member as Record<string, unknown>), ...(detail ?? {}) },
      /** Every active membership, each financially independent. */
      memberships: s.memberships,
      /** Aggregates across all memberships, computed in the database. */
      totals: s.totals,
      payments,
      penalties: penalties ?? [],
      payouts: payouts ?? [],
      announcements: announcements ?? [],
      myMessages: myMessages ?? [],
    })
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500)
  }
})
