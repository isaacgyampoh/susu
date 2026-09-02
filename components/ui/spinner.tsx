import { cx } from './util'

/**
 * A determinate-looking arc rather than a full ring: at 14px a full ring reads
 * as a static dot, and a spinner that does not obviously spin is worse than
 * none. `currentColor` so it inherits whatever it sits inside.
 */
export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      className={cx('animate-spin shrink-0', className)}
      role="presentation" aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity=".22" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  )
}

/** Full-region loading state for a panel whose height is not yet known. */
export function LoadingBlock({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <div className={cx('flex items-center justify-center gap-2.5 py-16 text-ink-3', className)} role="status">
      <Spinner size={18} />
      <span className="text-sm">{label}…</span>
    </div>
  )
}
