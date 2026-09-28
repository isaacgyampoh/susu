import { handleCors, json, error, serveWithCors } from '../_shared/cors.ts'
import { supabaseAdmin } from '../_shared/supabase-admin.ts'
import { requireAdmin } from '../_shared/jwt.ts'

/**
 * THE CATALOGUE, AS THE OPERATOR MANAGES IT.
 *
 *   GET                          every product, published or not, with plans
 *   POST   { product fields }    create
 *   PATCH  ?id=<uuid>            edit
 *   DELETE ?id=<uuid>            archive (never a hard delete)
 *   POST   ?id=<uuid>&plan=1     add a plan
 *   PATCH  ?plan_id=<uuid>       edit a plan
 *   POST   ?id=<uuid>&media=1    attach an uploaded image or video
 *   DELETE ?media_id=<uuid>      detach media
 *
 * ────────────────────────────────────────────────────────────────────────
 * ── EDITING A PRICE CANNOT REACH A LIVE PURCHASE ────────────────────────
 *
 * Worth stating where the editing happens: `purchases` snapshots every money
 * column at creation, so changing `cash_price` or retiring a plan here moves
 * nothing for a customer already paying. That is why this endpoint is allowed
 * to be as free as it is.
 *
 * ── ARCHIVE, NOT DELETE ─────────────────────────────────────────────────
 *
 * A product with purchases against it is somebody's history. DELETE sets the
 * status to `archived`, which removes it from the shop and leaves every
 * purchase, schedule and payment intact and readable. §28: "product is
 * unpublished — existing purchases must remain visible."
 */
serveWithCors(async (req) => {
  const cors = handleCors(req)
  if (cors) return cors

  const admin = await requireAdmin(req)
  if (!admin) return error('Unauthorized', 401, req)

  const url  = new URL(req.url)
  const uuid = (v: string | null) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : null)
  const id       = uuid(url.searchParams.get('id'))
  const planId   = uuid(url.searchParams.get('plan_id'))
  const mediaId  = uuid(url.searchParams.get('media_id'))
  const isPlan   = url.searchParams.get('plan')  === '1'
  const isMedia  = url.searchParams.get('media') === '1'

  const audit = (action: string, label: string, entity: string, details: unknown) =>
    supabaseAdmin.from('audit_log').insert({
      admin_id: admin.sub, admin_name: admin.full_name ?? admin.email,
      action, entity_type: 'product', entity_id: entity, entity_label: label,
      details: details as Record<string, unknown>,
    })

  const slugify = (s: string) =>
    s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100)

  try {
    // ── READ ──
    if (req.method === 'GET') {
      const { data: products, error: e } = await supabaseAdmin
        .from('products')
        .select(`id, name, slug, summary, description, specifications, cash_price,
                 status, stock_quantity, sort_order, created_at,
                 product_categories(id, name, slug),
                 payment_plans(id, name, frequency, duration_count, installment_amount,
                               deposit_amount, total_payable, is_active, terms, sort_order),
                 product_media(id, kind, storage_path, alt_text, sort_order)`)
        .order('sort_order').order('created_at', { ascending: false })
      if (e) return error(e.message, 502, req)

      const { data: categories } = await supabaseAdmin
        .from('product_categories').select('*').order('sort_order')

      // How many purchases exist per product, so the console can warn before
      // an archive rather than after.
      const { data: counts } = await supabaseAdmin
        .from('purchases').select('product_id')
      const used: Record<string, number> = {}
      for (const r of (counts ?? []) as { product_id: string | null }[]) {
        if (r.product_id) used[r.product_id] = (used[r.product_id] ?? 0) + 1
      }

      const { data: totals } = await supabaseAdmin.rpc('get_shop_totals')

      return json({
        products: (products ?? []).map((p) => ({
          ...(p as Record<string, unknown>),
          purchase_count: used[(p as { id: string }).id] ?? 0,
        })),
        categories: categories ?? [],
        totals: totals ?? null,
      }, 200, req)
    }

    // ── CATEGORY ──
    if (req.method === 'POST' && url.searchParams.get('category') === '1') {
      const b = await req.json().catch(() => null)
      if (!b?.name) return error('A category needs a name', 400, req)
      const { data, error: e } = await supabaseAdmin.from('product_categories')
        .insert({ name: String(b.name), slug: slugify(String(b.name)),
                  sort_order: Number(b.sort_order ?? 0) })
        .select('id, name, slug').single()
      if (e) return error(e.message, 400, req)
      return json({ category: data }, 201, req)
    }

    // ── PLAN ──
    if (req.method === 'POST' && id && isPlan) {
      const b = await req.json().catch(() => null)
      const count  = Number(b?.duration_count)
      const amount = Number(b?.installment_amount)
      const total  = Number(b?.total_payable)
      if (!b?.name)                      return error('The plan needs a name', 400, req)
      if (!Number.isFinite(count) || count < 1)
        return error('How many payments? That must be a whole number of 1 or more.', 400, req)
      if (!Number.isFinite(amount) || amount <= 0)
        return error('The instalment amount must be more than zero', 400, req)
      if (!Number.isFinite(total) || total <= 0)
        return error('The total payable must be more than zero', 400, req)

      const { data, error: e } = await supabaseAdmin.from('payment_plans').insert({
        product_id: id, name: String(b.name),
        frequency: b.frequency ?? 'monthly',
        duration_count: count, installment_amount: amount,
        deposit_amount: Number(b.deposit_amount ?? 0),
        total_payable: total,
        terms: b.terms ? String(b.terms) : null,
        sort_order: Number(b.sort_order ?? 0),
      }).select('id, name').single()
      if (e) return error(e.message, 400, req)

      await audit('product.plan_created', `${(data as {name:string}).name}`, id,
                  { duration_count: count, installment_amount: amount, total_payable: total })
      return json({ plan: data }, 201, req)
    }

    if (req.method === 'PATCH' && planId) {
      const b = await req.json().catch(() => null)
      const patch: Record<string, unknown> = {}
      for (const k of ['name','frequency','terms']) if (b?.[k] !== undefined) patch[k] = b[k]
      for (const k of ['duration_count','installment_amount','deposit_amount','total_payable','sort_order']) {
        if (b?.[k] !== undefined) {
          const n = Number(b[k])
          if (!Number.isFinite(n) || n < 0) return error(`${k} must be a number`, 400, req)
          patch[k] = n
        }
      }
      if (typeof b?.is_active === 'boolean') patch.is_active = b.is_active
      if (Object.keys(patch).length === 0) return error('Nothing to update', 400, req)

      const { error: e } = await supabaseAdmin.from('payment_plans')
        .update(patch).eq('id', planId)
      if (e) return error(e.message, 400, req)

      await audit('product.plan_edited', 'plan updated', planId, patch)
      return json({
        message: 'Plan updated. Customers already paying keep the terms they agreed to.',
      }, 200, req)
    }

    /* ── ASK FOR SOMEWHERE TO PUT A FILE ────────────────────────────────
       The console cannot write to the bucket directly: RLS is on for
       storage.objects with no policies, so anon and authenticated can write
       nothing — only the service role passes, and the service role must never
       reach a browser.

       The first version uploaded straight from the console with the anon key
       and could not have worked; the button was there and every upload would
       have failed.

       So this mints a short-lived signed URL scoped to ONE path, and the
       browser PUTs to that. The bytes still skip the edge worker — a 50MB
       video through a function would time out — and no write permission is
       handed to the public key to get it. */
    if (req.method === 'POST' && id && url.searchParams.get('upload') === '1') {
      const b = await req.json().catch(() => null)
      const name = String(b?.filename ?? 'file')
      const kind = String(b?.kind ?? 'image')
      if (!['image', 'video'].includes(kind)) {
        return error('Media must be an image or a video', 400, req)
      }
      // The path is built here, not accepted from the caller: a client-chosen
      // path is a client-chosen place to write.
      const safe = name.replace(/[^\w.-]/g, '').slice(-60) || 'file'
      const path = `${id}/${crypto.randomUUID()}-${safe}`

      const { data, error: e } = await supabaseAdmin
        .storage.from('product-media').createSignedUploadUrl(path)
      if (e) return error(e.message, 502, req)

      return json({ path, signedUrl: data?.signedUrl, token: data?.token }, 200, req)
    }

    // ── MEDIA ──
    // Records where a file landed after the browser uploaded it to the signed
    // URL above. The upload itself does not pass through this worker.
    if (req.method === 'POST' && id && isMedia) {
      const b = await req.json().catch(() => null)
      if (!b?.storage_path) return error('No file path given', 400, req)
      if (!['image','video'].includes(String(b.kind)))
        return error('Media must be an image or a video', 400, req)

      const { data, error: e } = await supabaseAdmin.from('product_media').insert({
        product_id: id, kind: String(b.kind),
        storage_path: String(b.storage_path),
        alt_text: b.alt_text ? String(b.alt_text) : null,
        sort_order: Number(b.sort_order ?? 0),
      }).select('id, kind, storage_path').single()
      if (e) return error(e.message, 400, req)
      return json({ media: data }, 201, req)
    }

    if (req.method === 'DELETE' && mediaId) {
      const { data: m } = await supabaseAdmin.from('product_media')
        .select('storage_path').eq('id', mediaId).single()
      await supabaseAdmin.from('product_media').delete().eq('id', mediaId)
      // Remove the object too, or the bucket grows for ever with files
      // nothing references.
      if (m) await supabaseAdmin.storage.from('product-media')
        .remove([(m as { storage_path: string }).storage_path]).catch(() => {})
      return json({ message: 'Removed' }, 200, req)
    }

    // ── PRODUCT ──
    if (req.method === 'POST') {
      const b = await req.json().catch(() => null)
      const price = Number(b?.cash_price)
      if (!b?.name)  return error('The product needs a name', 400, req)
      if (!Number.isFinite(price) || price < 0)
        return error('The cash price must be a number', 400, req)

      const { data, error: e } = await supabaseAdmin.from('products').insert({
        name: String(b.name), slug: slugify(String(b.slug ?? b.name)),
        category_id: uuid(b.category_id ?? null),
        summary: b.summary ? String(b.summary) : null,
        description: b.description ? String(b.description) : null,
        specifications: b.specifications ?? [],
        cash_price: price,
        stock_quantity: b.stock_quantity === null || b.stock_quantity === undefined
          ? null : Number(b.stock_quantity),
        status: b.status === 'published' ? 'published' : 'draft',
        created_by: admin.sub,
      }).select('id, name, slug, status').single()
      if (e) return error(e.message, 400, req)

      await audit('product.created', String(b.name), (data as {id:string}).id, { cash_price: price })
      return json({ product: data }, 201, req)
    }

    if (req.method === 'PATCH' && id) {
      const b = await req.json().catch(() => null)
      const patch: Record<string, unknown> = {}
      for (const k of ['name','summary','description','specifications']) {
        if (b?.[k] !== undefined) patch[k] = b[k]
      }
      if (b?.slug !== undefined)        patch.slug = slugify(String(b.slug))
      if (b?.category_id !== undefined) patch.category_id = uuid(b.category_id)
      if (b?.status !== undefined) {
        if (!['draft','published','archived'].includes(String(b.status)))
          return error('Status must be draft, published or archived', 400, req)
        patch.status = b.status
      }
      if (b?.cash_price !== undefined) {
        const n = Number(b.cash_price)
        if (!Number.isFinite(n) || n < 0) return error('The cash price must be a number', 400, req)
        patch.cash_price = n
      }
      if (b?.stock_quantity !== undefined) {
        patch.stock_quantity = b.stock_quantity === null ? null : Number(b.stock_quantity)
      }
      if (b?.sort_order !== undefined) patch.sort_order = Number(b.sort_order)
      if (Object.keys(patch).length === 0) return error('Nothing to update', 400, req)

      const { error: e } = await supabaseAdmin.from('products').update(patch).eq('id', id)
      if (e) return error(e.message, 400, req)

      await audit('product.edited', String(b?.name ?? 'product'), id, patch)
      return json({
        message: patch.cash_price !== undefined
          ? 'Saved. Customers already paying keep the price they bought at.'
          : 'Saved.',
      }, 200, req)
    }

    if (req.method === 'DELETE' && id) {
      const { count } = await supabaseAdmin
        .from('purchases').select('id', { count: 'exact', head: true }).eq('product_id', id)

      await supabaseAdmin.from('products').update({ status: 'archived' }).eq('id', id)
      await audit('product.archived', 'archived', id, { purchases: count ?? 0 })

      return json({
        message: count
          ? `Archived. It is off the shop, and the ${count} purchase${count === 1 ? '' : 's'} against it stay exactly as they are.`
          : 'Archived and removed from the shop.',
      }, 200, req)
    }

    return error('Method not allowed', 405, req)
  } catch (e) {
    console.error(e)
    return error('Something went wrong.', 500, req)
  }
})
