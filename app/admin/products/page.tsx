'use client'
import { useCallback, useEffect, useState } from 'react'
import { Package, Plus, Trash2 } from 'lucide-react'
import { callFunction, getAdminToken } from '@/lib/supabase'
import { ghs } from '@/lib/money'
import {
  Page, PageHeader, Button, EmptyState, Skeleton, Modal, Field,
  cx, useToast,
} from '@/components/ui'

/**
 * THE CATALOGUE.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Create a product, put pictures on it, and give it the plans people can buy
 * it on. Those three things are one job, so they are one screen: a product
 * with no plan cannot be bought, and splitting them across pages is how a
 * product ends up published with no way to pay for it.
 *
 * ── EDITING PRICES HERE IS SAFE ─────────────────────────────────────────
 * Every purchase snapshots its price and terms when it is created. Changing a
 * price or retiring a plan changes what NEW customers see and touches nobody
 * already paying. The screen says so where the editing happens, because an
 * operator who is unsure will otherwise avoid a change they are entitled to
 * make.
 */
interface Plan {
  id: string; name: string; frequency: string; duration_count: number
  installment_amount: number; deposit_amount: number; total_payable: number
  is_active: boolean; terms: string | null
}
interface Media { id: string; kind: string; storage_path: string }
interface Product {
  id: string; name: string; slug: string; summary: string | null
  description: string | null; cash_price: number; status: string
  stock_quantity: number | null; purchase_count: number
  product_categories: { id: string; name: string } | null
  payment_plans: Plan[]
  product_media: Media[]
}

const SB    = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const MEDIA = `${SB}/storage/v1/object/public/product-media/`

/* `Field` is a label/hint/error wrapper that hands its child the ids it needs.
   These two put the actual control inside it, so every input on this screen is
   labelled and described the same way without repeating the wiring. */
function Text({ label, name, hint, required, ...rest }: {
  label: string; name: string; hint?: string; required?: boolean
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} hint={hint} required={required}>
      {({ id, describedBy }) => (
        <input {...rest} id={id} name={name} required={required}
               aria-describedby={describedBy} className="in" />
      )}
    </Field>
  )
}

function Choose({ label, name, options, defaultValue }: {
  label: string; name: string; defaultValue?: string
  options: { value: string; label: string }[]
}) {
  return (
    <Field label={label}>
      {({ id }) => (
        <select id={id} name={name} defaultValue={defaultValue} className="in">
          {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}
    </Field>
  )
}

export default function AdminProductsPage() {
  const toast = useToast()
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [loading, setL] = useState(true)
  const [err, setErr]   = useState('')
  const [newOpen, setNewOpen] = useState(false)
  const [planFor, setPlanFor] = useState<Product | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState('')

  const load = useCallback(async () => {
    setL(true)
    const { data, error } = await callFunction<{
      products: Product[]; categories: { id: string; name: string }[]
    }>('admin-products', { token: getAdminToken()! })
    setL(false)
    setErr(error ?? '')
    setProducts(data?.products ?? [])
    setCategories(data?.categories ?? [])
  }, [])

  useEffect(() => { load() }, [load])

  async function createProduct(form: FormData) {
    setBusy(true)
    const { error } = await callFunction('admin-products', {
      method: 'POST', token: getAdminToken()!,
      body: {
        name: form.get('name'),
        cash_price: Number(form.get('cash_price')),
        summary: form.get('summary') || null,
        description: form.get('description') || null,
        category_id: form.get('category_id') || null,
        stock_quantity: form.get('stock') ? Number(form.get('stock')) : null,
        status: form.get('publish') === 'on' ? 'published' : 'draft',
      },
    })
    setBusy(false)
    if (error) { toast.error({ title: 'Could not create', body: error }); return }
    toast.success({ title: 'Product created', body: 'Add a payment plan so it can be bought.' })
    setNewOpen(false); load()
  }

  async function addPlan(product: Product, form: FormData) {
    setBusy(true)
    const { error } = await callFunction(`admin-products?id=${product.id}&plan=1`, {
      method: 'POST', token: getAdminToken()!,
      body: {
        name: form.get('name'),
        frequency: form.get('frequency'),
        duration_count: Number(form.get('duration_count')),
        installment_amount: Number(form.get('installment_amount')),
        total_payable: Number(form.get('total_payable')),
        deposit_amount: Number(form.get('deposit_amount') || 0),
      },
    })
    setBusy(false)
    if (error) { toast.error({ title: 'Could not add the plan', body: error }); return }
    toast.success({ title: 'Plan added' })
    setPlanFor(null); load()
  }

  /*
   * Three steps, and the middle one is the only place the bytes travel.
   *
   *   1. ask the function for a signed URL  (service role, one path, expires)
   *   2. PUT the file to it                 (browser → bucket, no worker)
   *   3. tell the function where it landed
   *
   * It used to POST straight to the bucket with the anon key, which could
   * never have worked: RLS is on for storage.objects with no policies, so the
   * public key can write nothing. The button was there and every upload failed.
   * Granting anon write access would have "fixed" it by letting anybody on the
   * internet fill the bucket.
   */
  async function upload(product: Product, file: File) {
    const kind = file.type.startsWith('video') ? 'video' : 'image'

    // Worth saying before the upload rather than after a long wait on a phone.
    const LIMIT = 50 * 1024 * 1024
    if (file.size > LIMIT) {
      toast.error({
        title: 'That file is too big',
        body: `${(file.size / 1024 / 1024).toFixed(0)}MB — the limit is 50MB. `
            + 'Shorten the video or save the photo at a smaller size.',
      })
      return
    }

    setUploading(product.id)
    try {
      const { data: slot, error: sErr } = await callFunction<
        { path: string; signedUrl: string; token: string }
      >(`admin-products?id=${product.id}&upload=1`, {
        method: 'POST', token: getAdminToken()!,
        body: { filename: file.name, kind },
      })
      if (sErr || !slot?.signedUrl) throw new Error(sErr ?? 'Could not prepare the upload')

      const put = await fetch(`${SB}/storage/v1${slot.signedUrl}`, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      })
      if (!put.ok) throw new Error(`Upload failed (${put.status})`)

      const { error } = await callFunction(`admin-products?id=${product.id}&media=1`, {
        method: 'POST', token: getAdminToken()!,
        body: { kind, storage_path: slot.path, alt_text: product.name },
      })
      if (error) throw new Error(error)

      toast.success({ title: kind === 'video' ? 'Video added' : 'Photo added' })
      load()
    } catch (e) {
      toast.error({ title: 'Could not add that file', body: (e as Error).message })
    } finally {
      setUploading('')
    }
  }

  async function removeMedia(id: string) {
    const { error } = await callFunction(`admin-products?media_id=${id}`, {
      method: 'DELETE', token: getAdminToken()!,
    })
    if (error) { toast.error({ title: 'Could not remove', body: error }); return }
    load()
  }

  async function setStatus(p: Product, status: string) {
    const { error } = await callFunction(`admin-products?id=${p.id}`, {
      method: 'PATCH', token: getAdminToken()!, body: { status },
    })
    if (error) { toast.error({ title: 'Could not update', body: error }); return }
    toast.success({ title: status === 'published' ? 'Published' : 'Moved to draft' })
    load()
  }

  return (
    <Page>
      <PageHeader
        title="Products"
        sub="What the shop sells, and how people can pay for it"
        actions={<Button icon={Plus} onClick={() => setNewOpen(true)}>New product</Button>}
      />

      {loading ? (
        <div className="space-y-3"><Skeleton className="h-40 rounded-xl" /><Skeleton className="h-40 rounded-xl" /></div>
      ) : err ? (
        <EmptyState icon={Package} title="Could not load products" body={err}
                    action={<Button onClick={load}>Try again</Button>} />
      ) : products.length === 0 ? (
        <EmptyState icon={Package} title="No products yet"
                    body="Add the first thing you sell — a fridge, a television, a blender — then give it a payment plan."
                    action={<Button icon={Plus} onClick={() => setNewOpen(true)}>New product</Button>} />
      ) : (
        <div className="space-y-4">
          {products.map(p => (
            <section key={p.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-display text-base font-semibold text-ink">{p.name}</h2>
                  <p className="text-xs text-ink-3 mt-0.5 tnum">
                    GHS {ghs(p.cash_price)} cash
                    {p.product_categories && ` · ${p.product_categories.name}`}
                    {p.stock_quantity !== null && ` · ${p.stock_quantity} in stock`}
                    {p.purchase_count > 0 && ` · ${p.purchase_count} bought`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={cx('text-2xs font-medium px-2 py-1 rounded-full',
                    p.status === 'published' ? 'bg-accent-soft text-accent'
                    : p.status === 'archived' ? 'bg-surface-2 text-ink-3'
                    : 'bg-surface-2 text-ink-2')}>
                    {p.status}
                  </span>
                  {p.status !== 'archived' && (
                    <Button size="sm" variant="outline"
                      onClick={() => setStatus(p, p.status === 'published' ? 'draft' : 'published')}>
                      {p.status === 'published' ? 'Unpublish' : 'Publish'}
                    </Button>
                  )}
                </div>
              </div>

              {/* Media. Added here, after the product exists, because a file
                  needs something to belong to. */}
              <div className="flex flex-wrap items-center gap-2 mt-3">
                {p.product_media.length === 0 && (
                  <p className="w-full text-xs text-ink-3 mb-1 leading-relaxed">
                    No pictures yet — add at least one, it is the first thing a
                    customer looks at.
                  </p>
                )}
                {p.product_media.map(m => (
                  <div key={m.id} className="relative w-16 h-16 rounded-lg overflow-hidden bg-surface-2 group">
                    {m.kind === 'image' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={MEDIA + m.storage_path} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="grid place-items-center w-full h-full text-2xs text-ink-3">video</span>
                    )}
                    <button type="button" onClick={() => removeMedia(m.id)}
                      aria-label="Remove this file"
                      className="absolute top-0.5 right-0.5 w-5 h-5 grid place-items-center rounded-full
                                 bg-ink/70 text-white opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity">
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))}
                {/* Says what it takes. "+ photo" hid the fact that videos
                    work at all, and a 64px square reads as a thumbnail rather
                    than as the way to add one. */}
                <label className={cx(
                  'min-w-[104px] h-16 px-3 rounded-lg border border-dashed border-line',
                  'grid place-items-center text-2xs text-center leading-tight',
                  'text-ink-2 cursor-pointer hover:border-ink/40 hover:text-ink transition-colors',
                  uploading === p.id && 'opacity-50 pointer-events-none')}>
                  {uploading === p.id
                    ? 'Uploading…'
                    : <span>+ Add photo<br /><span className="text-ink-3">or video</span></span>}
                  <input type="file" accept="image/*,video/*" className="sr-only"
                    onChange={e => { const f = e.target.files?.[0]; if (f) upload(p, f); e.target.value = '' }} />
                </label>
              </div>

              {/* Plans */}
              <div className="mt-4 pt-3 border-t border-line-2">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p className="t-eyebrow">Payment plans</p>
                  <Button size="sm" variant="outline" onClick={() => setPlanFor(p)}>Add plan</Button>
                </div>
                {p.payment_plans.length === 0 ? (
                  <p className="text-xs text-ink-3 leading-relaxed">
                    No plans yet — nobody can buy this until it has one.
                  </p>
                ) : (
                  <ul className="divide-y divide-line-2">
                    {p.payment_plans.map(pl => (
                      <li key={pl.id} className="flex items-baseline gap-3 py-2 text-sm">
                        <span className="text-ink flex-1 min-w-0 truncate">{pl.name}</span>
                        <span className="text-ink-2 tnum shrink-0">
                          {pl.duration_count} × GHS {ghs(pl.installment_amount)} {pl.frequency}
                        </span>
                        <span className="text-ink font-medium tnum shrink-0 w-[96px] text-right">
                          GHS {ghs(pl.total_payable)}
                        </span>
                        {!pl.is_active && <span className="text-2xs text-ink-3 shrink-0">inactive</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* New product */}
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="New product">
        <form onSubmit={e => { e.preventDefault(); createProduct(new FormData(e.currentTarget)) }}
              className="space-y-3">
          <Text label="Name" name="name" required placeholder='Samsung 55" Smart TV' />
          <Text label="Cash price (GHS)" name="cash_price" type="number" step="0.01" required
                hint="What it costs outright. Payment plans are priced separately." />
          <Text label="Short summary" name="summary" placeholder="4K, smart, two-year warranty" />
          <Field label="Description">
            {({ id }) => <textarea id={id} name="description" rows={3} className="in h-auto py-2" />}
          </Field>
          <Choose label="Category" name="category_id"
                  options={[{ value: '', label: 'None' },
                            ...categories.map(c => ({ value: c.id, label: c.name }))]} />
          <Text label="Stock" name="stock" type="number"
                hint="Leave empty if you can always get more." />
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" name="publish" className="w-4 h-4 accent-green" />
            Publish straight away
          </label>
          <p className="text-xs text-ink-3 leading-relaxed">
            A product needs at least one payment plan before anybody can buy it.
          </p>
          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create product'}</Button>
            <Button type="button" variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
          </div>
        </form>
      </Modal>

      {/* New plan */}
      <Modal open={!!planFor} onClose={() => setPlanFor(null)}
             title={planFor ? `Payment plan for ${planFor.name}` : 'Payment plan'}>
        {planFor && (
          <form onSubmit={e => { e.preventDefault(); addPlan(planFor, new FormData(e.currentTarget)) }}
                className="space-y-3">
            <Text label="Plan name" name="name" required placeholder="8 months" />
            <Choose label="How often" name="frequency" defaultValue="monthly"
                    options={[{ value: 'monthly', label: 'Monthly' },
                              { value: 'weekly', label: 'Weekly' },
                              { value: 'biweekly', label: 'Every two weeks' },
                              { value: 'daily', label: 'Daily' }]} />
            <Text label="Number of payments" name="duration_count" type="number" required
                  placeholder="8" />
            <Text label="Each payment (GHS)" name="installment_amount" type="number" step="0.01" required
                  placeholder="500" />
            <Text label="Total payable (GHS)" name="total_payable" type="number" step="0.01" required
                  placeholder="4000"
                  hint="Usually payments × amount, but it is stored as you set it — the figure the customer is shown is the figure they owe." />
            <Text label="Deposit (GHS)" name="deposit_amount" type="number" step="0.01"
                  placeholder="0" />
            <p className="text-xs text-ink-3 leading-relaxed">
              Editing or retiring a plan later affects new customers only. Anyone
              already paying keeps the terms they agreed to.
            </p>
            <div className="flex gap-2 pt-1">
              <Button type="submit" disabled={busy}>{busy ? 'Adding…' : 'Add plan'}</Button>
              <Button type="button" variant="outline" onClick={() => setPlanFor(null)}>Cancel</Button>
            </div>
          </form>
        )}
      </Modal>
    </Page>
  )
}
