import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin } from '../_shared/supabase-admin.ts'
import { rateLimit, tooManyMessage } from '../_shared/rate-limit.ts'
import { sendSMS, notifyAdmins, smsTemplates } from '../_shared/africas-talking.ts'

/**
 * ASKING TO PAY FOR SOMETHING GRADUALLY.
 *
 *   POST { plan_id, full_name, phone, whatsapp?, email?, address?, quantity?, note? }
 *
 * ────────────────────────────────────────────────────────────────────────
 * Public, and deliberately so: somebody enquiring about a fridge is not a
 * member and may never be one. Putting a sign-up between them and the enquiry
 * is how enquiries stop arriving.
 *
 * ── THIS GRANTS NOTHING ─────────────────────────────────────────────────
 *
 * It writes a row in `installment_requests` and nothing else. No purchase, no
 * schedule, no obligation, no stock held. The collector decides the terms and
 * creates the agreement herself, because agreeing credit with somebody is a
 * judgement about that person, not a form submission.
 *
 * The prices come from the plan in the database, so a tampered body cannot ask
 * for a television on terms nobody offered.
 *
 * Rate limited: it writes a row and sends the collector a message, and an
 * unmetered version of that is a way to flood both.
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'POST') return error('Method not allowed', 405, req)

  const gate = await rateLimit(req, 'shop-request', 5, 60)
  if (!gate.allowed) {
    return error(tooManyMessage(gate.retryAfterSeconds, 'requests from this device'), 429, req)
  }

  try {
    const b = await req.json().catch(() => null)
    if (!b) return error('Expected a JSON body', 400, req)

    const planId = String(b.plan_id ?? '')
    if (!/^[0-9a-f-]{36}$/i.test(planId)) {
      return error('Please choose a payment plan', 400, req)
    }
    if (!b.full_name || !b.phone) {
      return error('Your name and phone number are required', 400, req)
    }

    // Stored the way every other phone here is, so the collector sees one
    // person rather than three spellings of the same number.
    const norm = (v: unknown) =>
      String(v ?? '').trim().replace(/^0/, '+233').replace(/^\+?233/, '+233')

    const { data, error: e } = await supabaseAdmin.rpc('submit_installment_request', {
      p_plan_id:   planId,
      p_full_name: String(b.full_name),
      p_phone:     norm(b.phone),
      p_whatsapp:  b.whatsapp ? norm(b.whatsapp) : null,
      p_email:     b.email ? String(b.email) : null,
      p_address:   b.address ? String(b.address) : null,
      p_quantity:  Number(b.quantity ?? 1),
      p_note:      b.note ? String(b.note).slice(0, 600) : null,
    })
    if (e) return error(e.message, 400, req)

    /*
     * The collector must know a request has arrived — §22's one hard
     * requirement. Neither text failing may fail the request: the row is
     * written and she will see it in the console either way.
     */
    try {
      await notifyAdmins(
        `New instalment request: ${b.full_name} (${norm(b.phone)}) — ` +
        `${data.product}, ${data.plan}. Ref ${data.reference}. Open the console to review.`)
      await sendSMS(norm(b.phone), smsTemplates.requestReceived(
        String(b.full_name).split(' ')[0], String(data.product), String(data.reference)))
    } catch (err) {
      console.error('request notification failed (non-fatal):', (err as Error).message)
    }

    return json({
      reference: data.reference,
      message: 'Thank you. We have your request and will call you to arrange it.',
    }, 201, req)
  } catch (e) {
    console.error(e)
    return error('We could not send your request. Please try again.', 500, req)
  }
})
