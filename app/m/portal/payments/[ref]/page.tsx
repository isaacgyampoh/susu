'use client'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { callFunction, getMemberToken } from '@/lib/supabase'
import { ghs2 } from '@/lib/money'
import { AppBar } from '@/components/susu/app-bar'
import {
  FinancialAmount, FinancialStatus, FinancialSection,
  DetailRow, DetailRows, AllocationRow, TotalRow,
} from '@/components/susu/financial'
import { ButtonLink, EmptyState, Skeleton } from '@/components/ui'

/**
 * ONE PAYMENT, AS THE MEMBER WHO MADE IT.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The question this screen exists to answer is "what happened to my money",
 * and the answer is the allocation: which days the payment settled, and for how
 * much each. "Contribution payment — GHS 450" is not an answer.
 *
 * Everything is rendered, nothing derived. Days come from the allocation ledger
 * in the order it recorded them, so a payment that settled the 2nd, 5th and 9th
 * shows those three days rather than five consecutive ones. Amounts are never
 * divided out of the total, the group is never inferred from the member, and
 * credit is reported by the settlement engine rather than computed as "payment
 * minus allocations".
 *
 * ── STATE IS NEVER FLATTERED ────────────────────────────────────────────
 *
 * A pending payment says Processing and shows no allocations, because it has
 * settled nothing: NaloPay's confirmation is what makes a payment real, and
 * listing days against an unconfirmed payment would tell a member their
 * contribution is covered when it is not. A failed payment says so plainly.
 */

type Day = {
  due_date: string; amount: number; kind: string; obligation: number
  settled: boolean; remaining: number; reversed_at: string | null
}
type Group = { group_name: string; membership_id: string; allocated: number; days: Day[] }
type Detail = {
  payment: {
    reference: string; amount: number; status: string; type: string
    created_at: string; method: string; scope: string | null
  }
  groups: Group[]
  totals: { allocated: number; reversed: number; days: number; part_days: number }
  credit_banked: number
  settled_at: string | null
}

const day  = (d: string) => format(new Date(d + 'T12:00:00Z'), 'EEE d MMM yyyy')
const when = (t: string) => format(new Date(t), 'd MMMM yyyy')
const time = (t: string) => format(new Date(t), 'HH:mm')

export default function PaymentDetail() {
  const { ref } = useParams<{ ref: string }>()
  const [d, setD]          = useState<Detail | null>(null)
  const [loading, setLoad] = useState(true)
  const [err, setErr]      = useState('')

  const load = useCallback(async () => {
    setLoad(true); setErr('')
    const { data, error } = await callFunction<Detail>(
      `member-payment?ref=${encodeURIComponent(ref)}`, { token: getMemberToken()! },
    )
    setLoad(false)
    if (error || !data) { setErr(error || 'Payment not found'); return }
    setD(data)
  }, [ref])

  useEffect(() => { load() }, [load])

  return (
    <div className="animate-fade-in">
      <AppBar title="Payment" back={{ href: '/m/portal/payments', label: 'Back to payments' }} />

      <div className="portal-w pt-6 pb-4">
        {loading ? (
          <div className="space-y-4" role="status" aria-label="Loading this payment">
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-44 rounded-xl !mt-8" />
          </div>
        ) : err || !d ? (
          <EmptyState
            title="We couldn&rsquo;t open this payment"
            body="It may have been removed, or the link may be wrong. Your other payments are unaffected."
            action={<ButtonLink href="/m/portal/payments">Back to payments</ButtonLink>}
          />
        ) : (
          <Body d={d} />
        )}
      </div>
    </div>
  )
}

function Body({ d }: { d: Detail }) {
  const p = d.payment
  const settled  = p.status === 'success'
  const pending  = p.status === 'pending'
  const failed   = p.status === 'failed'
  const reversed = settled && d.totals.reversed > 0.005 && d.totals.days === 0
  const credit   = Number(d.credit_banked ?? 0)
  const purpose  = p.type === 'registration_fee' ? 'Registration fee' : 'Contribution'

  return (
    <>
      {/* How much, what happened, what for — in that order. */}
      <header>
        <h1 className="sr-only">{purpose} of GHS {ghs2(p.amount)} — {p.status}</h1>
        <FinancialAmount value={p.amount} />
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <FinancialStatus state={reversed ? 'reversed' : p.status} />
          <span className="text-base text-ink-2">{purpose}</span>
        </div>

        {pending && (
          <p className="text-sm text-ink-2 mt-3 leading-relaxed">
            We&rsquo;re confirming this payment with your mobile money provider.
            Nothing counts towards your contributions until it is confirmed.
          </p>
        )}
        {failed && (
          <p className="text-sm text-ink-2 mt-3 leading-relaxed">
            This payment did not go through, so nothing was taken and no
            contribution was covered. You can try again from Payments.
          </p>
        )}
        {reversed && (
          <p className="text-sm text-ink-2 mt-3 leading-relaxed">
            This payment was reversed, and the days it had covered were returned
            to unpaid.
          </p>
        )}
      </header>

      <FinancialSection title="Payment details">
        <DetailRows>
          <DetailRow label="Date" value={when(p.created_at)} />
          <DetailRow label="Time" value={time(p.created_at)} />
          <DetailRow label="Method" value={p.method} />
          {/* Group comes from what the payment SETTLED. A pending payment has
              settled nothing, so it has no group, and says so rather than
              borrowing one from the member's other memberships. */}
          <DetailRow
            label={d.groups.length > 1 ? 'Groups' : 'Group'}
            value={
              d.groups.length > 0
                ? d.groups.map(g => g.group_name).join(', ')
                : (
                  <span className="text-ink-3">
                    {pending ? 'Not assigned yet — still being confirmed' : 'None'}
                  </span>
                )
            }
          />
          <DetailRow label="Reference" value={p.reference} mono />
        </DetailRows>
      </FinancialSection>

      {/* The reason this screen exists. */}
      {settled && d.groups.length > 0 && (
        <FinancialSection
          title="What this paid for"
          note={`${d.totals.days} day${d.totals.days === 1 ? '' : 's'}`}
        >
          {d.groups.map(g => (
            <div key={g.membership_id} className="mb-5 last:mb-0">
              {d.groups.length > 1 && (
                <p className="text-sm font-medium text-ink mb-1">{g.group_name}</p>
              )}
              <div className="divide-y divide-line-2">
                {g.days.map((x, i) => (
                  <AllocationRow
                    key={i}
                    date={day(x.due_date)}
                    applied={x.amount}
                    obligation={x.obligation}
                    settled={x.settled}
                    remaining={x.remaining}
                    kind={x.kind}
                    reversed={!!x.reversed_at}
                  />
                ))}
              </div>
            </div>
          ))}

          <TotalRow label="Total put towards contributions" value={d.totals.allocated} />

          {/* Credit is reported separately and never folded into the allocation:
              it has not paid for a day yet, and it can only ever be spent in the
              group that holds it. */}
          {credit > 0.005 && (
            <>
              <div className="flex items-baseline justify-between gap-4 pt-2">
                <span className="text-sm text-ink-2">Kept as advance credit</span>
                <span className="text-sm font-medium text-ink tnum">GHS {ghs2(credit)}</span>
              </div>
              <p className="text-xs text-ink-3 mt-2 leading-relaxed">
                Left over after the days above. It stays with that group and is
                used automatically on its next contribution.
              </p>
            </>
          )}

          {d.totals.part_days > 0 && (
            <p className="text-xs text-warning mt-3">
              {d.totals.part_days} day{d.totals.part_days === 1 ? '' : 's'} above
              {d.totals.part_days === 1 ? ' is' : ' are'} only part covered.
            </p>
          )}
        </FinancialSection>
      )}

      {settled && d.groups.length === 0 && (
        <FinancialSection title="What this paid for">
          <p className="text-sm text-ink-2 leading-relaxed">
            This payment is recorded, but no contribution days were matched to it.
            Your susu admin can look into it for you.
          </p>
        </FinancialSection>
      )}

      <div className="mt-8">
        <Link href="/m/portal/payments"
          className="text-sm font-medium text-ink-2 hover:text-ink transition-colors">
          ← All payments
        </Link>
      </div>
    </>
  )
}
