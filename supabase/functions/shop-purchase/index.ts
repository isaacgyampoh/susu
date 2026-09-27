import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin } from '../_shared/supabase-admin.ts'
import { requireMember } from '../_shared/jwt.ts'
import { rateLimit, tooManyMessage } from '../_shared/rate-limit.ts'
import { sendSMS, smsTemplates } from '../_shared/africas-talking.ts'

/**
 * STARTING A PURCHASE.
 *
 *   POST { plan_id }
 *
 * ────────────────────────────────────────────────────────────────────────
 * The customer picks a plan; everything else follows from it. Notably the
 * client sends NO money figures — not the price, not the total, not the
 * instalment. `create_purchase` reads those from the plan in the database and
 * snapshots them, so a tampered request body cannot buy a television for one
 * cedi. This endpoint passes an id and a session, and that is all it could
 * pass even if someone tried.
 *
 * The member id is the VERIFIED SESSION's. A customer cannot open a purchase
 * in somebody else's name because there is no field in which to name them.
 *
 * Rate limited: creating a purchase writes a row and a schedule, and a loop
 * here would fill the table and decrement real stock.
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST') return error('Method not allowed', 405, req)

  const session = await requireMember(req)
  if (!session) return error('Unauthorized', 401, req)

  const gate = await rateLimit(req, 'shop-purchase', 10, 60)
  if (!gate.allowed) {
    return error(tooManyMessage(gate.retryAfterSeconds, 'purchase attempts'), 429, req)
  }

  try {
    const body = await req.json().catch(() => null)
    const planId = body?.plan_id
    if (!planId || !/^[0-9a-f-]{36}$/i.test(String(planId))) {
      return error('Please choose a payment plan', 400, req)
    }

    const { data, error: e } = await supabaseAdmin.rpc('create_purchase', {
      p_member_id: session.sub,
      p_plan_id:   String(planId),
    })

    if (e) {
      // "That plan is no longer offered", "out of stock" — the database raises
      // the sentence the customer should read, so it says one thing only.
      return error(e.message, 400, req)
    }

    /*
     * Tell them what they have taken on, with the first date. Failure to text
     * must not fail the purchase — the row is written and correct either way,
     * and a customer who got no SMS still sees it in their portal.
     */
    try {
      const { data: m } = await supabaseAdmin
        .from('members').select('full_name, phone').eq('id', session.sub).single()
      const who = m as { full_name: string; phone: string } | null
      if (who?.phone) {
        await sendSMS(who.phone, smsTemplates.purchaseStarted(
          who.full_name.split(' ')[0],
          String(data.product),
          Number(data.total).toFixed(2),
          Number(data.first_amount).toFixed(2),
          String(data.first_due),
        ))
      }
    } catch (e) {
      console.error('purchase SMS failed (non-fatal):', (e as Error).message)
    }

    return json({ purchase: data }, 201, req)
  } catch (e) {
    console.error(e)
    return error('We could not start that purchase. Please try again.', 500, req)
  }
})
