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

    // Never sign an arbitrary path handed to us
    if (!path.startsWith('ghana-cards/') || path.includes('..')) {
      return error('Invalid path', 400, req)
    }

    const { data, error: e } = await supabaseAdmin.storage
      .from('kyc-documents')
      .createSignedUrl(path, 120)   // two minutes is enough to look

    if (e) return error(e.message, 500, req)

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
