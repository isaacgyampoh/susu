'use client'
import { cx } from './util'

/* ---------------------------------------------------------------------------
   Two switchers, deliberately distinct so they never mean the same thing:

   Segmented — filters a set that is already on screen (all / due / paid).
   Underline — moves between views (a member's plans, a report's sections).
   ------------------------------------------------------------------------ */

export type TabItem<T extends string> = { value: T; label: React.ReactNode; count?: number }

export function Segmented<T extends string>({
  value, onChange, items, size = 'md', className, ariaLabel,
}: {
  value: T
  onChange: (v: T) => void
  items: TabItem<T>[]
  size?: 'sm' | 'md'
  className?: string
  ariaLabel?: string
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cx('seg', className)}>
      {items.map(t => {
        const on = t.value === value
        return (
          <button
            key={t.value}
            role="tab" aria-selected={on} type="button"
            onClick={() => onChange(t.value)}
            className={cx('seg-item', size === 'sm' && 'h-7 px-2.5 text-xs', on && 'seg-on')}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={cx('ml-1.5 tnum', on ? 'text-ink-3' : 'text-ink-3/70')}>{t.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function Tabs<T extends string>({
  value, onChange, items, className, ariaLabel,
}: {
  value: T
  onChange: (v: T) => void
  items: TabItem<T>[]
  className?: string
  ariaLabel?: string
}) {
  return (
    <div role="tablist" aria-label={ariaLabel}
      className={cx('flex gap-5 border-b border-line overflow-x-auto no-scrollbar', className)}>
      {items.map(t => {
        const on = t.value === value
        return (
          <button
            key={t.value}
            role="tab" aria-selected={on} type="button"
            onClick={() => onChange(t.value)}
            className={cx(
              'relative shrink-0 pb-2.5 -mb-px border-b-2 text-sm transition-colors whitespace-nowrap',
              on ? 'font-semibold text-ink border-ink' : 'font-medium text-ink-2 border-transparent hover:text-ink',
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={cx('ml-1.5 tnum text-xs', on ? 'text-ink-3' : 'text-ink-3/70')}>{t.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Horizontally scrolling chips. Used where the set can be long and unbounded —
 * a member in nine susu groups. Bleeds to the gutter so it is obvious it moves.
 */
export function ChipRow<T extends string>({
  value, onChange, items, className,
}: { value: T; onChange: (v: T) => void; items: TabItem<T>[]; className?: string }) {
  return (
    <div className={cx('flex gap-2 overflow-x-auto no-scrollbar -mx-5 px-5 pb-0.5', className)}>
      {items.map(t => {
        const on = t.value === value
        return (
          <button
            key={t.value} type="button" onClick={() => onChange(t.value)}
            aria-pressed={on}
            className={cx(
              'shrink-0 h-9 px-3.5 rounded-full text-sm font-medium transition-colors',
              on ? 'bg-ink text-inverse' : 'bg-surface border border-line text-ink-2 hover:text-ink',
            )}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}
