import type { LucideIcon } from 'lucide-react'
import { cx } from './util'

/* ---- Skeletons ------------------------------------------------------------
   A skeleton is only worth having if it is the shape of what is coming. A
   centred "Loading…" tells the reader nothing and makes the page jump when
   content lands; these hold the layout still.
   ------------------------------------------------------------------------ */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden="true" />
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cx('space-y-2', className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cx('h-3', i === lines - 1 ? 'w-2/3' : 'w-full')} />
      ))}
    </div>
  )
}

/** Placeholder for a table that is about to arrive. */
export function SkeletonTable({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="p-4 space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cx('h-3.5', c === 0 ? 'flex-[2]' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  )
}

export function SkeletonCards({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cx('grid grid-cols-2 lg:grid-cols-4 gap-3', className)} role="status" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card p-4">
          <Skeleton className="h-2.5 w-16" />
          <Skeleton className="h-6 w-24 mt-3" />
        </div>
      ))}
    </div>
  )
}

/* ---- Empty state ------------------------------------------------------- */

export function EmptyState({
  icon: Icon, title, body, action, className, compact,
}: {
  icon?: LucideIcon
  title: React.ReactNode
  body?: React.ReactNode
  action?: React.ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <div className={cx('text-center', compact ? 'py-10 px-5' : 'py-16 px-6', className)}>
      {Icon && (
        <div className="w-11 h-11 rounded-lg bg-surface-2 border border-line grid place-items-center mx-auto mb-4">
          <Icon size={19} strokeWidth={1.8} className="text-ink-3" aria-hidden="true" />
        </div>
      )}
      <p className="text-base font-semibold text-ink">{title}</p>
      {body && <p className="text-sm text-ink-2 mt-1.5 max-w-sm mx-auto leading-relaxed">{body}</p>}
      {action && <div className="mt-5 flex justify-center gap-2">{action}</div>}
    </div>
  )
}

/* ---- Progress ---------------------------------------------------------- */

export function Progress({
  value, max = 100, tone = 'ink', label, className,
}: {
  value: number
  max?: number
  tone?: 'ink' | 'accent' | 'warning' | 'danger'
  label?: string
  className?: string
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0
  return (
    <div
      className={cx('h-1.5 rounded-full bg-surface-3 overflow-hidden', className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}
      aria-label={label}
    >
      <div
        className={cx(
          'h-full rounded-full transition-[width] duration-500 ease-out',
          tone === 'ink' && 'bg-ink',
          tone === 'accent' && 'bg-accent',
          tone === 'warning' && 'bg-warning',
          tone === 'danger' && 'bg-danger',
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}
