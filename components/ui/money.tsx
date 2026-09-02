import { cx } from './util'
import { ghs, ghs2 } from '@/lib/money'

/* ---------------------------------------------------------------------------
   Money display.

   The rule this enforces: the *figure* is the thing being read, the currency
   is context. So "GHS" is set smaller, lighter and raised, and the number
   carries the weight — which is also what stops a four-digit cashout and a
   two-digit daily contribution from looking like the same piece of
   information.

   `exact` forces two decimals. Use it wherever a member is being asked to
   approve an amount: a GHS 10.90 contribution shown as "GHS 11" is not the
   number that leaves their wallet.
   ------------------------------------------------------------------------ */

const SIZE = {
  sm: { fig: 'text-base', cur: 'text-2xs' },
  md: { fig: 'text-xl',   cur: 'text-xs'  },
  lg: { fig: 'text-3xl',  cur: 'text-sm'  },
  xl: { fig: 'text-4xl',  cur: 'text-lg'  },
} as const

export function Money({
  value, size = 'md', exact, currency = 'GHS', className, sign,
}: {
  value: unknown
  size?: keyof typeof SIZE
  exact?: boolean
  currency?: string | false
  className?: string
  /** Prefixes +/− and tints. For ledger movements, not for balances. */
  sign?: 'in' | 'out'
}) {
  const s = SIZE[size]
  const n = exact ? ghs2(value) : ghs(value)
  return (
    <span className={cx(
      'inline-flex items-baseline gap-1 font-semibold tnum whitespace-nowrap',
      s.fig,
      sign === 'in' && 'text-success',
      sign === 'out' && 'text-ink',
      className,
    )}>
      {currency && <span className={cx(s.cur, 'font-medium opacity-60')}>{currency}</span>}
      <span>{sign === 'in' ? '+' : sign === 'out' ? '−' : ''}{n}</span>
    </span>
  )
}

/** Plain inline amount for table cells and sentences — no currency chrome. */
export function Amount({ value, exact, className }: { value: unknown; exact?: boolean; className?: string }) {
  return <span className={cx('tnum', className)}>{exact ? ghs2(value) : ghs(value)}</span>
}

/**
 * The figure tile used across both dashboards. `tone="ink"` is the hero — the
 * one number the screen exists to show.
 */
export function Stat({
  label, value, sub, tone = 'default', icon, className, children,
}: {
  label: React.ReactNode
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: 'default' | 'ink' | 'accent' | 'danger'
  icon?: React.ReactNode
  className?: string
  children?: React.ReactNode
}) {
  const ink = tone === 'ink' || tone === 'accent'
  return (
    <div className={cx(
      'rounded-lg border p-4 min-w-0',
      tone === 'ink' && 'bg-ink border-ink',
      tone === 'accent' && 'bg-accent border-accent',
      (tone === 'default' || tone === 'danger') && 'bg-surface border-line',
      className,
    )}>
      <div className="flex items-start justify-between gap-2">
        <p className={cx('text-xs font-medium truncate', ink ? 'text-inverse/65' : 'text-ink-3')}>{label}</p>
        {icon && <span className={cx('shrink-0', ink ? 'text-inverse/50' : 'text-ink-3')}>{icon}</span>}
      </div>
      <div className={cx(
        'mt-1.5 text-2xl font-semibold leading-none tnum',
        ink ? 'text-inverse' : tone === 'danger' ? 'text-danger' : 'text-ink',
      )}>
        {value}
      </div>
      {sub && (
        <p className={cx('text-xs mt-2 leading-relaxed', ink ? 'text-inverse/60' : 'text-ink-2')}>{sub}</p>
      )}
      {children}
    </div>
  )
}
