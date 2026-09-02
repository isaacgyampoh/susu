import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin }           from '../_shared/supabase-admin.ts'
import { requireAdmin }            from '../_shared/jwt.ts'

/**
 * Mints a short-lived signed URL for a Ghana Card.
 *
 * The bucket is private. Nothing else can read it. Every view is recorded —
 * looking at someone's national ID is a privileged act and should leave a trace.
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  // A GET here used to reach `req.json()` on an empty body, throw, and be
  // caught as a 500 — an unparseable request is the caller's mistake, not a
  // server fault, and a 500 sends people looking for an outage.
  if (req.method !== 'POST') return error('Method not allowed', 405, req)

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401, req)

  try {
    const body = await req.json().catch(() => null)
    if (!body) return error('A JSON body with a document path is required', 400, req)
    const { path, subject } = body
    if (!path) return error('path is required', 400, req)

    // Never sign an arbitrary path handed to us. The checks are on the raw
    // string BEFORE any decoding, so an encoded traversal cannot slip through
    // by arriving as %2e%2e and being normalised later.
    if (typeof path !== 'string' || path.length > 400) {
      return error('Invalid path', 400, req)
    }
    const suspicious = path.includes('..') || path.includes('\\') ||
                       path.startsWith('/') || /%2e|%2f|%5c/i.test(path)
    if (!path.startsWith('ghana-cards/') || suspicious) {
      return error('Invalid path', 400, req)
    }

    const { data, error: e } = await supabaseAdmin.storage
      .from('kyc-documents')
      .createSignedUrl(path, 120)   // two minutes is enough to look

    /*
     * ── A MISSING DOCUMENT IS AN EXPECTED STATE, NOT A SERVER FAULT ───────
     *
     * Every storage failure used to become `error(e.message, 500)`. That is
     * wrong twice over.
     *
     * It is wrong operationally: 27 applications were taken while the KYC
     * bucket did not exist, so they hold a Ghana Card number and no image.
     * Opening one of those is a NORMAL thing for an administrator to do, and it
     * answered with a 500 — which reads as an outage and sends somebody looking
     * for a broken server instead of telling them the truth, which is that the
     * document was never stored.
     *
     * And it is wrong for disclosure: `e.message` is the storage layer's own
     * text, returned verbatim to the caller. Internal errors are for the log.
     */
    if (e || !data?.signedUrl) {
      const raw = (e?.message ?? '').toLowerCase()
      const missing = raw.includes('not found') || raw.includes('does not exist') ||
                      raw.includes('no such') || raw.includes('object not found')

      console.error('admin-document: could not sign', path, e?.message)

      if (missing) {
        await supabaseAdmin.from('document_access_log').insert({
          admin_id: admin.sub, admin_name: admin.full_name ?? admin.email,
          subject: subject ?? 'unknown', object_path: path,
          outcome: 'missing',
        }).then(() => {}, () => {})   // logging must never break the response

        return json({
          error: 'This document is not available. It was never stored — the applicant needs to upload it again.',
          code:  'DOCUMENT_UNAVAILABLE',
        }, 404, req)
      }
      return error('The document store did not respond. Please try again.', 502, req)
    }

    await supabaseAdmin.from('document_access_log').insert({
      admin_id:    admin.sub,
      admin_name:  admin.full_name ?? admin.email,
      subject:     subject ?? 'unknown',
      object_path: path,
    })

    return json({ url: data.signedUrl, expires_in: 120 }, 200, req)
  } catch (e) {
    console.error(e)
    return error('Internal server error', 500, req)
  }
})
