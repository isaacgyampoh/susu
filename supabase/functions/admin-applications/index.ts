import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'
import { createMemberships, refuseCapacity } from '../_shared/join.ts'
import { sendSMS } from '../_shared/africas-talking.ts'

/**
 * APPLICATIONS TO JOIN A GROUP.
 *
 *   GET  ?group=<uuid>          the pending queue, all groups or one
 *   POST { id, action, reason } approve or reject one
 *
 * ────────────────────────────────────────────────────────────────────────
 * ── APPROVING GOES THROUGH THE SAME PATH AS JOINING ─────────────────────
 *
 * `createMemberships` is what a direct join calls, and it is what runs here.
 * Writing a second membership-creation path is how the fraction
 * multiplication came to be copied into five files, and the failure mode is
 * worse than a wrong amount: a member approved into a group with no
 * contribution schedule owes nothing, pays nothing, and nobody notices until
 * the payout is due.
 *
 * ── CAPACITY IS CHECKED AT THE DECISION, NOT THE APPLICATION ────────────
 *
 * A group can fill between somebody applying and somebody approving. The
 * check runs again here, against the group as it is now, so approving into a
 * full group refuses rather than overfilling it.
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401, req)

  try {
    if (req.method === 'GET') {
      const g = new URL(req.url).searchParams.get('group')
      const { data, error: e } = await supabaseAdmin.rpc('get_application_queue', {
        p_group_id: /^[0-9a-f-]{36}$/i.test(g ?? '') ? g : null,
      })
      if (e) {
        console.error('get_application_queue:', e.message)
        return error('We could not load applications. Please try again.', 502, req)
      }
      return json({ applications: data ?? [] }, 200, req)
    }

    if (req.method !== 'POST') return error('Method not allowed', 405, req)

    const body   = await req.json().catch(() => ({}))
    const id     = String(body?.id ?? '')
    const action = String(body?.action ?? '')
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 300) : ''

    if (!/^[0-9a-f-]{36}$/i.test(id)) return error('Unknown application', 404, req)
    if (!['approve', 'reject'].includes(action)) return error('action must be approve or reject', 400, req)
    if (action === 'reject' && reason.length < 5) {
      return error('Give a short reason — the member is told why.', 400, req)
    }

    const { data: app } = await supabaseAdmin
      .from('group_applications')
      .select('id, group_id, member_id, slots, slot_fraction, status')
      .eq('id', id).maybeSingle()

    if (!app) return error('Unknown application', 404, req)
    if (app.status !== 'pending') {
      return error(`This application was already ${app.status}.`, 409, req)
    }

    const { data: member } = await supabaseAdmin
      .from('members').select('id, full_name, phone').eq('id', app.member_id).single()

    const { data: group } = await supabaseAdmin
      .from('susu_groups')
      .select('id, name, status, max_members, current_members, registration_fee, cashout_amount, contribution_amount')
      .eq('id', app.group_id).single()
    if (!group) return error('That group no longer exists', 404, req)

    // ── REJECT ──────────────────────────────────────────────────────────
    if (action === 'reject') {
      const { error: uErr } = await supabaseAdmin.from('group_applications')
        .update({
          status: 'rejected', decided_at: new Date().toISOString(),
          decided_by: admin.sub, decision_reason: reason,
        })
        .eq('id', id).eq('status', 'pending')      // never re-decide a decided one
      if (uErr) return error(uErr.message, 500, req)

      await supabaseAdmin.from('audit_log').insert({
        admin_id: admin.sub, admin_name: admin.full_name ?? admin.email,
        action: 'application.rejected', entity_type: 'group_application', entity_id: id,
        entity_label: `${member?.full_name ?? 'member'} → ${group.name}`,
        details: { reason },
      })

      if (member?.phone) {
        await sendSMS(member.phone,
          `Hi ${member.full_name.split(' ')[0]}, your request to join ${group.name} was not approved. ${reason} — Abbie Wealth`)
      }
      return json({ message: 'Application rejected' }, 200, req)
    }

    // ── APPROVE ─────────────────────────────────────────────────────────
    // The group may have filled since they applied.
    const refusal = refuseCapacity(group, app.slots)
    if (refusal) return error(refusal, 409, req)

    const { positions, membershipIds, portion, registrationFee } = await createMemberships({
      memberId: app.member_id,
      group,
      slots: app.slots,
      fraction: Number(app.slot_fraction),
      describedAs: `Registration fee for "${group.name}"${app.slots > 1 ? ` × ${app.slots} slots` : ''} (application approved — awaiting payment)`,
    })

    if (positions.length === 0) {
      return error('Could not create the membership. Nothing was changed.', 500, req)
    }

    await supabaseAdmin.from('group_applications')
      .update({
        status: 'approved', decided_at: new Date().toISOString(),
        decided_by: admin.sub, decision_reason: reason || null,
        membership_id: membershipIds[0] ?? null,
      })
      .eq('id', id).eq('status', 'pending')

    await supabaseAdmin.from('audit_log').insert({
      admin_id: admin.sub, admin_name: admin.full_name ?? admin.email,
      action: 'application.approved', entity_type: 'group_application', entity_id: id,
      entity_label: `${member?.full_name ?? 'member'} → ${group.name}`,
      details: {
        slots: positions.length, positions,
        portion: portion.label, registration_fee: registrationFee,
      },
    })

    if (member?.phone) {
      await sendSMS(member.phone,
        `Hi ${member.full_name.split(' ')[0]}, you have been approved to join ${group.name}` +
        `${registrationFee > 0 ? `. Your registration fee is GHS ${registrationFee.toFixed(2)}` : ''}` +
        `. Open your portal to see your contributions. — Abbie Wealth`)
    }

    return json({
      message: `${member?.full_name ?? 'Member'} approved into ${group.name}`,
      slots: positions.length, portion: portion.label, registration_fee: registrationFee,
    }, 200, req)
  } catch (e) {
    console.error(e)
    return error('Something went wrong. Nothing was changed.', 500, req)
  }
})
