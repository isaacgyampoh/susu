import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { generatePasscode, hashPasscode, passcodeErrorResponse } from '../_shared/passcode.ts'
import { requireAdmin }            from '../_shared/jwt.ts'
import { sendSMS }                 from '../_shared/africas-talking.ts'

serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401)

  const url    = new URL(req.url)
  const method = req.method
  const id     = url.searchParams.get('id')
  const membershipId = url.searchParams.get('membership_id')

  try {
    // GET /admin-members?membership_id=xxx — this membership + same-group
    // memberships of OTHER members it could share a payout turn with
    if (method === 'GET' && membershipId) {
      const { data: gm } = await supabaseAdmin
        .from('group_memberships')
        .select('id, member_id, group_id, payout_position, payout_date, slot_fraction, shared_slot_key')
        .eq('id', membershipId).single()
      if (!gm) return error('Membership not found', 404)

      const { data: others } = await supabaseAdmin
        .from('group_memberships')
        .select('id, payout_position, payout_date, slot_fraction, shared_slot_key, payout_received, members!member_id(full_name, member_id)')
        .eq('group_id', gm.group_id).eq('status', 'active')
        .neq('member_id', gm.member_id)

      return json({
        membership: gm,
        candidates: (others ?? [])
          .filter((o: any) => !o.payout_received)
          .map((o: any) => ({
            id: o.id,
            full_name: o.members?.full_name,
            member_code: o.members?.member_id,
            payout_position: o.payout_position,
            payout_date: o.payout_date,
            slot_fraction: Number(o.slot_fraction ?? 1),
            already_paired: !!o.shared_slot_key && o.shared_slot_key === gm.shared_slot_key,
          })),
      })
    }

    // PATCH /admin-members?membership_id=xxx — edit payout details on a plan
    if (method === 'PATCH' && membershipId) {
      const body = await req.json()

      const { data: gm } = await supabaseAdmin
        .from('group_memberships')
        .select('id, member_id, group_id, payout_position, payout_received, payout_date, shared_slot_key, susu_groups(name)')
        .eq('id', membershipId).single()
      if (!gm) return error('Membership not found', 404)

      const updates: Record<string, unknown> = {}

      if (body.payout_position !== undefined && body.payout_position !== null && body.payout_position !== '') {
        const newPos = Number(body.payout_position)
        if (!Number.isInteger(newPos) || newPos < 1) return error('payout_position must be a positive whole number')
        if (newPos !== gm.payout_position) {
          const { data: clash } = await supabaseAdmin
            .from('group_memberships').select('id')
            .eq('group_id', gm.group_id).eq('payout_position', newPos)
            .neq('id', membershipId).maybeSingle()
          if (clash) return error(`Payout position #${newPos} is already taken in this group`, 409)

          /*
           * ── A SLOT IS SET WHEN THE GROUP STARTS ──────────────────────────
           *
           * The payout position is the member's turn in the rotation. Everyone
           * else's turn is arranged around it, so moving one after the group is
           * running reorders other people's expectations of when they collect.
           *
           * This used to be a bare field update: any admin, any time, no reason
           * recorded, no audit entry, and permitted even on a membership whose
           * payout had already been PAID — which would have moved the turn of
           * someone who had already taken it.
           *
           * Contributions are keyed by membership_id, not by position, so no
           * financial history moves either way. What changes is whose turn is
           * when, and that is exactly the thing worth a reason and a record.
           */
          if (gm.payout_received) {
            return error(
              `${(gm.susu_groups as { name?: string } | null)?.name ?? 'This member'} has already ` +
              `received the payout for slot #${gm.payout_position}. Its turn cannot be moved — ` +
              `the money for it has already gone out.`, 409)
          }

          const { data: grp } = await supabaseAdmin
            .from('susu_groups').select('status, name').eq('id', gm.group_id).single()
          const started = grp && ['active', 'completed'].includes(grp.status as string)
          const reason = typeof body.slot_change_reason === 'string' ? body.slot_change_reason.trim() : ''

          if (started && reason.length < 10) {
            return error(
              `"${grp?.name}" has already started, so slot #${gm.payout_position} is part of a ` +
              `running rotation. Moving it needs a reason of at least 10 characters, which is ` +
              `written to the audit log.`, 400)
          }

          await supabaseAdmin.from('audit_log').insert({
            admin_id: admin.sub, admin_name: admin.full_name ?? admin.email,
            action: 'membership.slot_changed', entity_type: 'membership', entity_id: membershipId,
            entity_label: `${grp?.name ?? 'group'} · slot #${gm.payout_position} → #${newPos}`,
            details: {
              from: gm.payout_position, to: newPos, group_started: !!started,
              reason: reason || null, member_id: gm.member_id,
            },
          })

          updates.payout_position = newPos
        }
      }
      if (body.payout_date !== undefined)   updates.payout_date   = body.payout_date || null
      if (body.payout_amount !== undefined && body.payout_amount !== '') {
        const amt = Number(body.payout_amount)
        if (isNaN(amt) || amt < 0) return error('payout_amount must be a positive number')
        updates.payout_amount = amt
      }
      if (typeof body.payout_received === 'boolean') updates.payout_received = body.payout_received

      // Pairing: link this slot's payout turn with partner memberships
      if (Array.isArray(body.pair_with)) {
        const partnerIds: string[] = body.pair_with.filter(Boolean)
        const key = crypto.randomUUID()
        const pairDate = (typeof updates.payout_date === 'string' ? updates.payout_date : null)
          ?? (gm as any).payout_date ?? null

        const allIds = [membershipId, ...partnerIds]
        const patch: Record<string, unknown> = { shared_slot_key: key }
        if (pairDate) patch.payout_date = pairDate

        const { error: pairErr } = await supabaseAdmin
          .from('group_memberships').update(patch)
          .in('id', allIds).eq('group_id', gm.group_id)
        if (pairErr) return error(pairErr.message, 500)

        if (pairDate) {
          await supabaseAdmin.from('payouts').update({ scheduled_date: pairDate })
            .in('membership_id', allIds).eq('status', 'upcoming')
        }
        return json({ message: `Payout turn shared across ${allIds.length} slots${pairDate ? ` on ${pairDate}` : ''}` })
      }

      if (body.unpair === true) {
        await supabaseAdmin.from('group_memberships')
          .update({ shared_slot_key: null }).eq('id', membershipId)
        return json({ message: 'Slot unpaired — its payout date now moves independently' })
      }

      if (Object.keys(updates).length === 0 && !body.regenerate) return error('Nothing to update')

      if (Object.keys(updates).length === 0 && body.regenerate) {
        const { data: inserted, error: gErr } = await supabaseAdmin
          .rpc('generate_membership_schedule', { p_membership_id: membershipId })
        if (gErr) return error(`Could not generate schedule: ${gErr.message}. Run the pending migrations (v18) first.`, 500)
        return json({ message: `${inserted ?? 0} payment day${inserted === 1 ? '' : 's'} generated` })
      }

      const { error: upErr } = await supabaseAdmin
        .from('group_memberships').update(updates).eq('id', membershipId)
      if (upErr) return error(upErr.message, 500)

      // Partners share the turn: a date change moves everyone together
      if ((gm as any).shared_slot_key && typeof updates.payout_date === 'string') {
        const { data: partners } = await supabaseAdmin
          .from('group_memberships').select('id')
          .eq('shared_slot_key', (gm as any).shared_slot_key).neq('id', membershipId)
        const pids = (partners ?? []).map((r: any) => r.id)
        if (pids.length) {
          await supabaseAdmin.from('group_memberships')
            .update({ payout_date: updates.payout_date }).in('id', pids)
          await supabaseAdmin.from('payouts')
            .update({ scheduled_date: updates.payout_date })
            .in('membership_id', pids).eq('status', 'upcoming')
        }
      }

      // Reconcile the payouts record with whatever the membership now says.
      // Received ⇒ a 'paid' row; a date but not received ⇒ an 'upcoming' row;
      // neither ⇒ no scheduled row at all.
      {
        const { data: fresh } = await supabaseAdmin
          .from('group_memberships')
          .select('payout_date, payout_amount, payout_received')
          .eq('id', membershipId).single()

        const { data: rows } = await supabaseAdmin
          .from('payouts').select('id, status, paid_at')
          .eq('membership_id', membershipId)
          .order('created_at', { ascending: false }).limit(1)
        const row = rows?.[0]

        if (fresh?.payout_received) {
          const patch = {
            status: 'paid', paid_at: row?.paid_at ?? new Date().toISOString(),
            scheduled_date: fresh.payout_date ?? new Date().toISOString().split('T')[0],
            total_amount: fresh.payout_amount ?? 0,
          }
          if (row) await supabaseAdmin.from('payouts').update(patch).eq('id', row.id)
          else await supabaseAdmin.from('payouts').insert({
            member_id: gm.member_id, group_id: gm.group_id, membership_id: membershipId,
            ...patch, notes: 'Marked received by admin edit',
          })
        } else if (fresh?.payout_date) {
          const patch = {
            status: 'upcoming', paid_at: null,
            scheduled_date: fresh.payout_date, total_amount: fresh.payout_amount ?? 0,
          }
          if (row) await supabaseAdmin.from('payouts').update(patch).eq('id', row.id)
          else await supabaseAdmin.from('payouts').insert({
            member_id: gm.member_id, group_id: gm.group_id, membership_id: membershipId,
            ...patch, notes: 'Scheduled by admin edit',
          })
        } else if (row && row.status === 'upcoming') {
          await supabaseAdmin.from('payouts').delete().eq('id', row.id)
        }
      }

      // Repair path: if this slot never got its schedule (joined an active
      // group before v18), editing it fills the schedule in — idempotent.
      await supabaseAdmin.rpc('generate_membership_schedule', { p_membership_id: membershipId })
        .then(({ error: sErr }) => { if (sErr) console.log('schedule gen skipped:', sErr.message) })

      return json({ message: 'Payout details updated' })
    }

    // DELETE /admin-members?all=true — wipe EVERY member for a fresh start.
    // Groups survive (and are re-opened); all member records — paid or not —
    // are erased. Requires the exact confirmation phrase in the body.
    // POST /admin-members?id=xxx  { action: 'reset_passcode' | 'portal_link', send_sms? }
    if (method === 'POST' && id) {
      const body = await req.json().catch(() => ({}))
      const MEMBER_URL = Deno.env.get('MEMBER_URL') ?? 'https://my.abbiewealthsusu.com'
      const SIGNIN_URL = `${MEMBER_URL}/m/login`

      const { data: m } = await supabaseAdmin
        .from('members').select('id, full_name, member_id, phone').eq('id', id).single()
      if (!m) return error('Member not found', 404)

      if (body.action === 'portal_link') {
        // Just hand back the link + ID for the admin to copy into WhatsApp
        return json({
          portal_url: SIGNIN_URL,
          member_id: m.member_id,
          whatsapp_text: `Hello ${m.full_name.split(' ')[0]}, here is your Abbie Wealth Susu portal: ${SIGNIN_URL} — Member ID: ${m.member_id}. Log in to see your savings and pay. Keep your passcode private.`,
          whatsapp_link: m.phone ? `https://wa.me/${m.phone.replace(/[^0-9]/g, '').replace(/^0/, '233')}` : null,
        })
      }

      if (body.action === 'reset_passcode') {
        const passcode = generatePasscode()
        const hash = await hashPasscode(passcode)
        const { error: upErr } = await supabaseAdmin
          .from('members').update({ passcode_hash: hash, credentials_sent_at: new Date().toISOString() }).eq('id', id)
        if (upErr) return error(upErr.message, 500)

        let smsSent = false
        if (body.send_sms !== false && m.phone) {
          smsSent = await sendSMS(m.phone,
            `Hello ${m.full_name.split(' ')[0]}, your Abbie Wealth Susu passcode has been reset. ID: ${m.member_id} | New passcode: ${passcode} | Sign in: ${SIGNIN_URL} | Keep it private.`)
        }
        return json({
          passcode, member_id: m.member_id, portal_url: SIGNIN_URL, sms_sent: smsSent,
          whatsapp_text: `Hello ${m.full_name.split(' ')[0]}, your Abbie Wealth Susu login — ID: ${m.member_id}, Passcode: ${passcode}, Sign in: ${SIGNIN_URL}. Keep your passcode private.`,
          whatsapp_link: m.phone ? `https://wa.me/${m.phone.replace(/[^0-9]/g, '').replace(/^0/, '233')}` : null,
        })
      }

      return error('Unknown action', 400)
    }

    if (method === 'DELETE' && url.searchParams.get('all') === 'true') {
      const body = await req.json().catch(() => ({}))
      if (body.confirm !== 'DELETE ALL MEMBERS') {
        return error("Confirmation phrase missing. Send { confirm: 'DELETE ALL MEMBERS' } to proceed.", 400)
      }

      /*
       * ── PHASE 08: THIS MAY NOT RUN AGAINST A LIVE BOOK ────────────────────
       *
       * A confirmation phrase is not a preservation strategy. This path deletes
       * every transaction, contribution, payout, membership and member
       * unconditionally — and point-in-time recovery is disabled on this
       * project, so the recovery floor is the last nightly backup. Running it
       * at noon would cost every payment collected that morning.
       *
       * It exists to reset a fresh instance, and that use is preserved: with no
       * settled money it still works. The moment a single payment has been
       * received it refuses, and names what it would have destroyed.
       *
       * Members who leave are suspended or removed — their money history has to
       * outlive them.
       */
      const [{ count: settledPayments }, { count: paidDays }] = await Promise.all([
        supabaseAdmin.from('transactions').select('*', { count: 'exact', head: true }).eq('status', 'success'),
        supabaseAdmin.from('contributions').select('*', { count: 'exact', head: true }).eq('status', 'paid'),
      ])
      if ((settledPayments ?? 0) > 0 || (paidDays ?? 0) > 0) {
        await supabaseAdmin.from('audit_log').insert({
          admin_id: admin.sub, admin_name: admin.full_name ?? admin.email,
          action: 'members.wipe_refused', entity_type: 'system', entity_id: null,
          entity_label: 'DELETE ALL MEMBERS',
          details: { settled_payments: settledPayments, paid_days: paidDays,
                     note: 'Refused: the book carries settled money.' },
        }).then(() => {}, () => {})
        return error(
          `Refused. This book carries ${settledPayments} settled payment(s) and ${paidDays} paid ` +
          `contribution day(s). Deleting everything would destroy that record, and point-in-time ` +
          `recovery is not enabled on this project. Suspend or remove members individually instead.`,
          409)
      }

      // Counts for the audit trail
      const [{ count: nMembers }, { count: nContribs }, { count: nPayouts }] = await Promise.all([
        supabaseAdmin.from('members').select('*', { count: 'exact', head: true }),
        supabaseAdmin.from('contributions').select('*', { count: 'exact', head: true }),
        supabaseAdmin.from('payouts').select('*', { count: 'exact', head: true }),
      ])

      const wipe: [string, () => PromiseLike<{ error: { message: string } | null }>][] = [
        ['notifications',  () => supabaseAdmin.from('notifications').delete().not('id', 'is', null)],
        ['transactions',   () => supabaseAdmin.from('transactions').delete().not('id', 'is', null)],
        ['contributions',  () => supabaseAdmin.from('contributions').delete().not('id', 'is', null)],
        ['payouts',        () => supabaseAdmin.from('payouts').delete().not('id', 'is', null)],
        ['kyc links',      () => supabaseAdmin.from('kyc_applications').update({ created_member_id: null }).not('created_member_id', 'is', null)],
        ['memberships',    () => supabaseAdmin.from('group_memberships').delete().not('id', 'is', null)],
        ['members',        () => supabaseAdmin.from('members').delete().not('id', 'is', null)],
        // Active groups with nobody in them go back to open, ready to refill
        ['groups reset',   () => supabaseAdmin.from('susu_groups')
            .update({ status: 'open', start_date: null, end_date: null }).eq('status', 'active')],
      ]
      for (const [label, run] of wipe) {
        const { error: stepErr } = await run()
        if (stepErr) return error(`Reset failed at ${label}: ${stepErr.message}`, 500)
      }

      await supabaseAdmin.from('audit_log').insert({
        admin_id: admin.sub, admin_name: (admin as any).full_name ?? (admin as any).email,
        action: 'members.deleted_all', entity_type: 'member', entity_id: null,
        entity_label: `FRESH START — wiped ${nMembers ?? 0} members`,
        details: { members: nMembers ?? 0, contributions: nContribs ?? 0, payouts: nPayouts ?? 0 },
      })

      return json({
        message: `Fresh start complete: ${nMembers ?? 0} members and all their records deleted. Groups kept and re-opened.`,
        deleted: { members: nMembers ?? 0, contributions: nContribs ?? 0, payouts: nPayouts ?? 0 },
      })
    }

    // DELETE /admin-members?id=xxx — permanently erase a mistakenly created member
    // This is for mistakes (duplicates, wrong entries), not for members leaving —
    // those should be suspended/removed so their money history survives.
    if (method === 'DELETE' && id) {
      const { data: member } = await supabaseAdmin
        .from('members').select('id, member_id, full_name, phone').eq('id', id).single()
      if (!member) return error('Member not found', 404)

      /*
       * Money history runs in BOTH directions, and this only ever checked one.
       *
       * Refusing on a paid payout catches a member who has RECEIVED money. It
       * does not catch one who has PAID — someone two years into a daily susu
       * with GHS 40,000 contributed and no payout yet was deletable, and their
       * entire payment record would have gone with them.
       *
       * The rule is now symmetric: any settled payment, any paid day, or any
       * paid payout makes this member's history real, and real history is
       * preserved. Deletion stays available for what it was written for —
       * duplicates and mistyped entries, which have none of those.
       */
      const [{ count: paidPayouts }, { count: settledPayments }, { count: paidDays }] = await Promise.all([
        supabaseAdmin.from('payouts').select('*', { count: 'exact', head: true })
          .eq('member_id', id).eq('status', 'paid'),
        supabaseAdmin.from('transactions').select('*', { count: 'exact', head: true })
          .eq('member_id', id).eq('status', 'success'),
        supabaseAdmin.from('contributions').select('*', { count: 'exact', head: true })
          .eq('member_id', id).eq('status', 'paid'),
      ])
      if ((paidPayouts ?? 0) > 0 || (settledPayments ?? 0) > 0 || (paidDays ?? 0) > 0) {
        const parts = [
          (settledPayments ?? 0) > 0 && `${settledPayments} settled payment(s)`,
          (paidDays ?? 0) > 0       && `${paidDays} paid day(s)`,
          (paidPayouts ?? 0) > 0    && `${paidPayouts} paid payout(s)`,
        ].filter(Boolean).join(', ')
        await supabaseAdmin.from('audit_log').insert({
          admin_id: admin.sub, admin_name: admin.full_name ?? admin.email,
          action: 'member.delete_refused', entity_type: 'member', entity_id: id,
          entity_label: member.full_name,
          details: { settled_payments: settledPayments, paid_days: paidDays, paid_payouts: paidPayouts },
        }).then(() => {}, () => {})
        return error(
          `${member.full_name} has ${parts} on record. Deleting would erase real money history — ` +
          `suspend or remove them instead, which keeps it.`, 409)
      }

      // Unwind dependents in FK order (children before parents)
      const steps: [string, () => PromiseLike<{ error: { message: string } | null }>][] = [
        ['notifications',  () => supabaseAdmin.from('notifications').delete().eq('member_id', id)],
        ['transactions',   () => supabaseAdmin.from('transactions').delete().eq('member_id', id)],
        ['contributions',  () => supabaseAdmin.from('contributions').delete().eq('member_id', id)],
        ['payouts',        () => supabaseAdmin.from('payouts').delete().eq('member_id', id)],
        // References TO this member from other rows become null, not blockers
        ['replaced_by refs', () => supabaseAdmin.from('group_memberships').update({ replaced_by: null }).eq('replaced_by', id)],
        ['kyc link',       () => supabaseAdmin.from('kyc_applications').update({ created_member_id: null }).eq('created_member_id', id)],
        ['memberships',    () => supabaseAdmin.from('group_memberships').delete().eq('member_id', id)],
        ['member',         () => supabaseAdmin.from('members').delete().eq('id', id)],
      ]
      for (const [label, run] of steps) {
        const { error: stepErr } = await run()
        if (stepErr) return error(`Delete failed at ${label}: ${stepErr.message}`, 500)
      }

      await supabaseAdmin.from('audit_log').insert({
        admin_id: admin.sub, admin_name: (admin as any).full_name ?? (admin as any).email,
        action: 'member.deleted', entity_type: 'member', entity_id: id,
        entity_label: `${member.member_id} — ${member.full_name}`,
        details: { phone: member.phone, reason: 'admin hard delete' },
      })

      return json({ message: `${member.full_name} and all their records have been deleted` })
    }

    // GET /admin-members — list all members with filters
    if (method === 'GET' && !id) {
      const status = url.searchParams.get('status') ?? 'active'
      const search = url.searchParams.get('search')
      const page   = parseInt(url.searchParams.get('page') ?? '1')
      const limit  = 20
      const offset = (page - 1) * limit

      let query = supabaseAdmin
        .from('members')
        .select(`
          id, member_id, full_name, phone, email, status, created_at,
          group_memberships!member_id(count),
          contributions(count)
        `, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (status !== 'all') query = query.eq('status', status)
      if (search) query = query.or(`full_name.ilike.%${search}%,phone.ilike.%${search}%,member_id.ilike.%${search}%`)

      const { data: members, count, error: dbErr } = await query
      if (dbErr) return error(dbErr.message, 500)

      return json({ members, total: count, page, limit })
    }

    // GET /admin-members?id=xxx — single member detail
    if (method === 'GET' && id) {
      const { data: member, error: dbErr } = await supabaseAdmin
        .from('members')
        .select(`
          *,
          group_memberships!member_id(
            id, group_id, slot_fraction, shared_slot_key, payout_position, payout_date, payout_amount, payout_received, status, joined_at,
            susu_groups(id, name, contribution_amount, status)
          ),
          contributions(id, amount, due_date, paid_at, status, paystack_ref, susu_groups(name)),
          payouts(id, total_amount, scheduled_date, paid_at, status, susu_groups(name)),
          transactions(id, type, amount, status, reference, created_at)
        `)
        .eq('id', id)
        .single()

      if (dbErr) return error('Member not found', 404)

      // Name the partners on any shared payout turns
      const keys = [...new Set(((member as any).group_memberships ?? [])
        .map((gm: any) => gm.shared_slot_key).filter(Boolean))]
      if (keys.length > 0) {
        const { data: partners } = await supabaseAdmin
          .from('group_memberships')
          .select('shared_slot_key, slot_fraction, member_id, members!member_id(full_name)')
          .in('shared_slot_key', keys).neq('member_id', id)
        const byKey: Record<string, string[]> = {}
        for (const p of partners ?? []) {
          const f = Number((p as any).slot_fraction ?? 1)
          const lbl = `${(p as any).members?.full_name}${f < 1 ? ` (${f === 0.25 ? '¼' : '½'})` : ''}`
          ;(byKey[(p as any).shared_slot_key] ??= []).push(lbl)
        }
        for (const gm of (member as any).group_memberships ?? []) {
          if (gm.shared_slot_key) gm.shared_with = byKey[gm.shared_slot_key] ?? []
        }
      }

      return json({ member })
    }

    // PATCH /admin-members?id=xxx — update member status and/or send a message
    if (method === 'PATCH' && id) {
      const { status, message } = await req.json()

      // Message-only: just SMS the member, change nothing
      if (!status && message) {
        const { data: member } = await supabaseAdmin
          .from('members').select('full_name, phone').eq('id', id).single()
        if (!member) return error('Member not found', 404)

        await sendSMS(member.phone, message)
        await supabaseAdmin.from('notifications').insert({
          member_id: id, type: 'sms', message, status: 'sent', sent_at: new Date().toISOString(),
        })
        return json({ message: 'Message sent' })
      }

      const allowed = ['active','suspended','removed']
      if (!allowed.includes(status)) return error(`status must be one of: ${allowed.join(', ')}`)

      const { data: member } = await supabaseAdmin
        .from('members')
        .update({ status })
        .eq('id', id)
        .select('full_name, phone')
        .single()

      if (member && message) {
        await sendSMS(member.phone, `Hi ${member.full_name}, ${message}`)
        await supabaseAdmin.from('notifications').insert({
          member_id: id, type: 'sms', message, status: 'sent', sent_at: new Date().toISOString(),
        })
      }

      return json({ message: `Member status updated to ${status}` })
    }

    return error('Not found', 404)
  } catch (e) {
    const pc = passcodeErrorResponse(e, error)
    if (pc) return pc
    console.error(e)
    return error('Internal server error', 500)
  }
})
