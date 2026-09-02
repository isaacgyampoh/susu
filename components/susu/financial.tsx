'use client'
import { ghs2 } from '@/lib/money'
import { cx } from '@/components/ui'

/* ---------------------------------------------------------------------------
   HOW ABBIE WEALTH EXPLAINS MONEY

   The vocabulary a member's financial screens share. Payment detail is the
   first user; group detail, the statement and the account screen are meant to
   be the next, which is why nothing here knows what a payment is.

   The rule: a figure is read before it is understood, so the AMOUNT carries the
   weight and everything qualifying it is set quieter. A financial record is not
   a celebration — a successful payment gets a word, not a green circle.
   ------------------------------------------------------------------------ */

/** The screen's headline figure. One per screen. */
export function FinancialAmount({
  value, size = 'lg', className,
}: { value: unknown; size?: 'md' | 'lg'; className?: string }) {
  return (
    <p className={cx(
      'font-display font-semibold tracking-[-.03em] tnum text-ink whitespace-nowrap',
      size === 'lg' ? 'text-[34px] leading-none' : 'text-xl leading-none',
      className,
    )}>
      <span className={cx('font-medium opacity-45 mr-1.5', size === 'lg' ? 'text-lg' : 'text-sm')}>GHS</span>
      {ghs2(value)}
    </p>
  )
}

const STATE = {
  success:  { label: 'Successful',  cls: 'text-success', dot: 'bg-success' },
  pending:  { label: 'Processing',  cls: 'text-warning', dot: 'bg-warning' },
  failed:   { label: 'Failed',      cls: 'text-danger',  dot: 'bg-danger'  },
  reversed: { label: 'Reversed',    cls: 'text-warning', dot: 'bg-warning' },
} as const

/** A word and a marker. Not a pill, not a badge, not a checkmark. */
export function FinancialStatus({ state }: { state: keyof typeof STATE | string }) {
  const s = STATE[state as keyof typeof STATE] ?? STATE.pending
  return (
    <span className={cx('inline-flex items-center gap-2 text-base font-medium', s.cls)}>
      <span aria-hidden="true" className={cx('w-1.5 h-1.5 rounded-full', s.dot)} />
      {s.label}
    </span>
  )
}

/** A titled band. Separated by a rule, not wrapped in a card. */
export function FinancialSection({
  title, note, children, className,
}: { title?: string; note?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx('border-t border-line pt-5 mt-5', className)}>
      {title && (
        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2 className="t-eyebrow">{title}</h2>
          {note && <span className="text-xs text-ink-3">{note}</span>}
        </div>
      )}
      {children}
    </section>
  )
}

/** Label left, value right. Labels stay subordinate; values stay readable. */
export function DetailRow({
  label, value, mono,
}: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="text-sm text-ink-3 shrink-0">{label}</dt>
      <dd className={cx('text-sm text-ink text-right min-w-0 break-words',
                        mono && 'font-mono text-xs')}>
        {value ?? <span className="text-ink-3">—</span>}
      </dd>
    </div>
  )
}

export function DetailRows({ children }: { children: React.ReactNode }) {
  return <dl className="divide-y divide-line-2">{children}</dl>
}

/**
 * One obligation this payment touched.
 *
 * `settled` comes from the contribution's own status, never from subtracting
 * amounts: thousands of historical days are settled with no amount recorded
 * against them, and doing the subtraction would tell a member they still owe
 * money they paid months ago.
 */
export function AllocationRow({
  date, applied, obligation, settled, remaining, kind, reversed,
}: {
  date: string
  applied: unknown
  obligation: unknown
  settled: boolean
  remaining: unknown
  kind: 'full' | 'part' | string
  reversed?: boolean
}) {
  const rem = Number(remaining ?? 0)
  return (
    <div className={cx('flex items-baseline justify-between gap-4 py-2.5', reversed && 'opacity-55')}>
      <div className="min-w-0">
        <p className="text-sm text-ink tnum">{date}</p>
        <p className="text-xs text-ink-3 mt-0.5">
          {kind === 'part' ? 'Part of ' : ''}GHS {ghs2(obligation)} due
          {reversed && ' · reversed'}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-medium text-ink tnum">GHS {ghs2(applied)}</p>
        {!settled && rem > 0.005 && (
          <p className="text-xs text-warning tnum mt-0.5">GHS {ghs2(rem)} still owed</p>
        )}
      </div>
    </div>
  )
}

/** The line a member checks last: does it add up. */
export function TotalRow({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex items-baseline justify-between gap-4 pt-3 mt-1 border-t border-line">
      <span className="text-sm font-medium text-ink">{label}</span>
      <span className="text-base font-semibold text-ink tnum">GHS {ghs2(value)}</span>
    </div>
  )
}
