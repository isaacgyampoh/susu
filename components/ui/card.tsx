import Link from 'next/link'
import { cx } from './util'

type Pad = 'none' | 'sm' | 'md' | 'lg'
const PAD: Record<Pad, string> = { none: '', sm: 'p-3.5', md: 'p-4 sm:p-5', lg: 'p-5 sm:p-6' }

export function Card({
  pad = 'md', tone = 'default', interactive, className, children, ...rest
}: {
  pad?: Pad
  /** `ink` is the hero surface — one per screen at most, or it stops meaning anything. */
  tone?: 'default' | 'ink' | 'accent' | 'muted'
  interactive?: boolean
  className?: string
  children?: React.ReactNode
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        'rounded-lg border',
        tone === 'ink'    && 'bg-ink border-ink text-inverse',
        tone === 'accent' && 'bg-accent border-accent text-inverse',
        tone === 'muted'  && 'bg-surface-2 border-line',
        tone === 'default'&& 'bg-surface border-line',
        interactive && 'card-hover',
        PAD[pad], className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

/** A whole card that navigates. Keeps the hit area honest — the card is the link. */
export function CardLink({
  href, pad = 'md', className, children, ...rest
}: { href: string; pad?: Pad; className?: string; children?: React.ReactNode } &
   Omit<React.ComponentProps<typeof Link>, 'href' | 'className' | 'children'>) {
  return (
    <Link
      href={href}
      className={cx('block rounded-lg border bg-surface border-line card-hover', PAD[pad], className)}
      {...rest}
    >
      {children}
    </Link>
  )
}

/** Title row for a card. `action` sits right, baseline-aligned with the title. */
export function CardHead({
  title, sub, action, className,
}: { title: React.ReactNode; sub?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-start justify-between gap-3 mb-4', className)}>
      <div className="min-w-0">
        <h2 className="t-h2 truncate">{title}</h2>
        {sub && <p className="t-meta mt-0.5">{sub}</p>}
      </div>
      {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
    </div>
  )
}

/** Inset strip inside a card — totals, breakdowns, anything summarising rows above. */
export function Well({ className, children }: { className?: string; children?: React.ReactNode }) {
  return <div className={cx('bg-surface-2 border border-line rounded-md p-3.5', className)}>{children}</div>
}
