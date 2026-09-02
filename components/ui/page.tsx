import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { cx } from './util'

/* ---------------------------------------------------------------------------
   Page scaffolding. Gutters, max width and the header block were being
   re-declared on every screen with slightly different values — `px-5 sm:px-8`
   here, `px-5 sm:px-8 lg:px-10` there — so pages did not line up with each
   other when you navigated between them.
   ------------------------------------------------------------------------ */

export function Page({
  children, className, width = 'wide',
}: { children: React.ReactNode; className?: string; width?: 'wide' | 'narrow' | 'full' }) {
  return (
    <div className={cx(
      'px-5 sm:px-8 py-6 sm:py-8 pb-20 animate-fade-in',
      width === 'wide' && 'max-w-[1400px] mx-auto',
      width === 'narrow' && 'max-w-3xl mx-auto',
      className,
    )}>
      {children}
    </div>
  )
}

export function PageHeader({
  title, sub, actions, back, className,
}: {
  title: React.ReactNode
  sub?: React.ReactNode
  actions?: React.ReactNode
  back?: { href: string; label: string }
  className?: string
}) {
  return (
    <header className={cx('mb-6', className)}>
      {back && (
        <Link
          href={back.href}
          className="inline-flex items-center gap-1 -ml-1 mb-3 text-xs font-medium text-ink-2
                     hover:text-ink transition-colors"
        >
          <ChevronLeft size={14} strokeWidth={2.4} aria-hidden="true" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="t-title">{title}</h1>
          {sub && <p className="text-sm text-ink-2 mt-1 leading-relaxed">{sub}</p>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap shrink-0">{actions}</div>}
      </div>
    </header>
  )
}

export function Section({
  title, sub, action, children, className,
}: {
  title?: React.ReactNode
  sub?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cx('min-w-0', className)}>
      {(title || action) && (
        <div className="flex items-end justify-between gap-3 mb-3">
          <div className="min-w-0">
            {title && <h2 className="t-h2">{title}</h2>}
            {sub && <p className="t-meta mt-0.5">{sub}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

/** Label/value list — the shape used by every detail panel in the console. */
export function DetailList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <dl className={cx('divide-y divide-line-2', className)}>{children}</dl>
}

export function DetailRow({
  label, children, mono,
}: { label: React.ReactNode; children: React.ReactNode; mono?: boolean }) {
  if (children === null || children === undefined || children === '') return null
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-xs text-ink-2 shrink-0">{label}</dt>
      <dd className={cx('text-sm font-medium text-ink text-right min-w-0 break-words', mono && 'font-mono text-xs')}>
        {children}
      </dd>
    </div>
  )
}
