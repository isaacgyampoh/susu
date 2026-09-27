import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin } from '../_shared/supabase-admin.ts'

/**
 * THE SHOP WINDOW.
 *
 *   GET            every published product, with plans and media
 *   GET ?slug=xxx  one product
 *
 * ────────────────────────────────────────────────────────────────────────
 * Public and unauthenticated, because a catalogue that needs a login is not a
 * catalogue. What makes that safe is `get_public_catalogue` itself: it selects
 * only published rows, and it never touches `purchases` or `members`, so there
 * is no customer data in the result to leak. Stock is reduced to a boolean —
 * "in stock" is what a shopper needs; the exact count is the business's.
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors
  if (req.method !== 'GET') return error('Method not allowed', 405, req)

  try {
    const raw = new URL(req.url).searchParams.get('slug')
    // Slugs are the only thing this takes; anything else is not a lookup.
    const slug = raw && /^[a-z0-9-]{1,120}$/i.test(raw) ? raw : null

    const { data, error: e } = await supabaseAdmin
      .rpc('get_public_catalogue', { p_slug: slug })

    if (e) {
      console.error('get_public_catalogue:', e.message)
      return error('We could not load the products. Please try again.', 502, req)
    }
    return json(data ?? { categories: [], products: [] }, 200, req)
  } catch (e) {
    console.error(e)
    return error('Something went wrong loading the products.', 500, req)
  }
})
