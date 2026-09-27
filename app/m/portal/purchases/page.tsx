'use client'
import { useCallback, useEffect, useState } from 'react'
import { ShoppingBag } from 'lucide-react'
import { callFunction, getMemberToken } from '@/lib/supabase'
import { AppBar } from '@/components/susu/app-bar'
import { PurchaseCard, type PurchaseRow } from '@/components/susu/purchases'
import { Button, EmptyState, Skeleton, useToast } from '@/components/ui'
import { ghs } from '@/lib/money'

/**
 * MY PURCHASES.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Everything a customer is paying off, what is left on each, and the button
 * that pays the next instalment.
 *
 * The figures all come from `get_member_purchases`, which computes them in
 * SQL from the schedule. Nothing on this page adds money up: a balance
 * calculated in the browser is a second opinion about what somebody owes, and
 * the two opinions diverge the first time a payment part-settles.
 */
interface Payload {
  totals: {
    purchases: number; active: number; completed: number
    total_value: number; paid: number; balance: number
  }
  purchases: PurchaseRow[]
}

export default function PurchasesPage() {
  const toast = useToast()
  const [data, setData]   = useState<Payload | null>(null)
  const [loading, setL]   = useState(true)
  const [failed, setFail] = useState('')
  const [paying, setPaying] = useState('')

  const load = useCallback(async () => {
    setL(true); setFail('')
    const { data, error } = await callFunction<Payload>('member-purchases', {
      token: getMemberToken()!,
    })
    setL(false)
    if (error) { setFail(error); return }
    setData(data ?? null)
  }, [])

  useEffect(() => { load() }, [load])

  async function pay(p: PurchaseRow) {
    setPaying(p.id)
    const { data, error } = await callFunction<{ message: string }>('shop-pay', {
      method: 'POST', token: getMemberToken()!,
      body: { purchase_id: p.id },
    })
    setPaying('')
    if (error) { toast.error({ title: 'Could not start the payment', body: error }); return }
    toast.success({ title: 'Check your phone', body: data?.message ?? 'Approve the payment on your phone.' })
    // The prompt is on the customer's handset now; the balance moves when the
    // provider confirms, not when this returns.
    setTimeout(load, 6000)
  }

  if (loading) return (
    <div>
      <AppBar title="My purchases" />
      <div className="portal-w pt-6 space-y-3" role="status" aria-label="Loading your purchases">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
    </div>
  )

  if (failed) return (
    <div>
      <AppBar title="My purchases" />
      <div className="portal-w pt-10">
        <EmptyState
          icon={ShoppingBag}
          title="Could not load your purchases"
          body="This is usually temporary. Nothing you have paid has changed."
          action={<Button onClick={load}>Try again</Button>}
        />
      </div>
    </div>
  )

  const t = data?.totals
  const rows = data?.purchases ?? []

  return (
    <div className="animate-fade-in">
      <AppBar title="My purchases" />

      <div className="portal-w pt-6 pb-4">
        {rows.length === 0 ? (
          <EmptyState
            icon={ShoppingBag}
            title="Nothing on the way yet"
            body="When you buy something and pay for it bit by bit, it appears here with what is left to pay."
          />
        ) : (
          <>
            {/* One line of totals, not a row of tiles. Three numbers a customer
                already half knows do not each need a card. */}
            {t && (
              <div className="border-y border-line py-3.5 mb-4">
                <p className="t-eyebrow">Across everything</p>
                <p className="flex items-baseline gap-2 mt-1">
                  <span className="font-display text-2xl font-semibold text-ink tnum tracking-[-.02em]">
                    GHS {ghs(t.balance)}
                  </span>
                  <span className="text-sm text-ink-2">left to pay</span>
                </p>
                <p className="text-xs text-ink-3 mt-1 tnum">
                  GHS {ghs(t.paid)} paid across {t.purchases} purchase
                  {t.purchases === 1 ? '' : 's'}
                  {t.completed > 0 && ` · ${t.completed} finished`}
                </p>
              </div>
            )}

            <div className="space-y-3">
              {rows.map(p => (
                <PurchaseCard
                  key={p.id}
                  p={p}
                  href={`/m/portal/purchases/${p.id}`}
                  onPay={paying === p.id ? undefined : pay}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
