'use client'
import { useEffect, useRef } from 'react'
import { cx } from './util'
import { Money } from './money'

/* ---------------------------------------------------------------------------
   WORKSPACE PRIMITIVES

   The shared vocabulary for admin operations screens. Payments is the first
   consumer; Members, Groups, Payouts and Reconciliation are meant to be the
   next ones, which is why nothing here knows what a payment is.

   The rule these follow: hierarchy comes from type, spacing and alignment, not
   from putting things in boxes. A card is a real device with a real cost — it
   draws a border, claims a background, and says "this is separate from that".
   Used on everything it says nothing at all, which is how a console ends up
   looking like a template. So there are no cards in this file.
   ------------------------------------------------------------------------ */

/* ── Metric ────────────────────────────────────────────────────────────────
   A figure with a label. `primary` is the one number the screen is about, and
   there should be exactly one of them; everything else is context and is set
   quieter so the eye lands in the right place first. */
export function Metric({
  label, value, sub, primary, tone, exact = true,
}: {
  label: string
  value: unknown
  sub?: React.ReactNode
  primary?: boolean
  tone?: 'good' | 'warn' | 'bad'
  exact?: boolean
}) {
  return (
    <div className="min-w-0">
      <p className="t-eyebrow mb-1.5">{label}</p>
      <Money
        value={value}
        exact={exact}
        size={primary ? 'lg' : 'md'}
        className={cx(
          tone === 'good' && 'text-success',
          tone === 'warn' && 'text-warning',
          tone === 'bad'  && 'text-danger',
          !tone && 'text-ink',
        )}
      />
      {sub && <p className="text-xs text-ink-3 mt-1.5 truncate">{sub}</p>}
    </div>
  )
}

/** A row of metrics separated by rules rather than boxed into cards. */
export function MetricRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-y-6 gap-x-5
                    border-y border-line py-5
                    lg:divide-x lg:divide-line
                    [&>*]:lg:px-6 [&>*:first-child]:lg:pl-0">
      {children}
    </div>
  )
}

/* ── Search ───────────────────────────────────────────────────────────────── */
export function SearchBar({
  value, onChange, placeholder = 'Search…', className, autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
}) {
  return (
    <div className={cx('relative', className)}>
      <svg aria-hidden="true" viewBox="0 0 20 20"
        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-3 pointer-events-none">
        <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M13.5 13.5 17 17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full h-11 pl-9 pr-9 rounded-[10px] bg-surface-2 border border-line
                   text-base text-ink placeholder:text-ink-3 outline-none
                   transition-[border-color,background-color]
                   focus:border-ink focus:bg-surface focus:ring-[3px] focus:ring-ink/[0.07]
                   [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label="Clear search"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 grid place-items-center
                     rounded-lg text-ink-3 hover:text-ink hover:bg-surface-3 transition-colors">
          <svg viewBox="0 0 16 16" className="w-3.5 h-3.5" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  )
}

/* ── Active filters ───────────────────────────────────────────────────────
   Shown as removable chips. A filter you cannot see is a filter you will
   forget you applied, and then the empty result looks like missing data. */
export function FilterChips({
  chips, onClear,
}: {
  chips: { key: string; label: string; onRemove: () => void }[]
  onClear: () => void
}) {
  if (chips.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {chips.map(c => (
        <span key={c.key}
          className="inline-flex items-center gap-1.5 h-7 pl-2.5 pr-1.5 rounded-lg
                     bg-surface-2 border border-line text-xs text-ink-2">
          {c.label}
          <button type="button" onClick={c.onRemove} aria-label={`Remove filter ${c.label}`}
            className="w-5 h-5 grid place-items-center rounded text-ink-3
                       hover:text-ink hover:bg-surface-3 transition-colors">
            <svg viewBox="0 0 16 16" className="w-3 h-3" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </span>
      ))}
      <button type="button" onClick={onClear}
        className="text-xs font-medium text-ink-2 underline underline-offset-2
                   hover:text-ink transition-colors h-7 px-1">
        Clear filters
      </button>
    </div>
  )
}

/* ── Segmented status filter ─────────────────────────────────────────────── */
export function StatusTabs({
  value, onChange, options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string; count?: number }[]
}) {
  return (
    <div role="tablist" aria-label="Filter by status"
      className="flex gap-1 overflow-x-auto no-scrollbar -mx-1 px-1">
      {options.map(o => {
        const on = o.value === value
        return (
          <button key={o.value} role="tab" aria-selected={on} type="button"
            onClick={() => onChange(o.value)}
            className={cx(
              'shrink-0 h-9 px-3 rounded-[9px] text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30',
              on ? 'bg-ink text-inverse' : 'text-ink-2 hover:text-ink hover:bg-surface-2',
            )}>
            {o.label}
            {typeof o.count === 'number' && (
              <span className={cx('ml-1.5 tnum', on ? 'opacity-60' : 'text-ink-3')}>{o.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* ── Mobile record ───────────────────────────────────────────────────────
   A table row is a poor shape on a 360px screen: eight columns become eight
   unreadable ones. This is the same information re-ranked — the figure leads,
   identity follows, detail is quiet — as a single ≥44px target. */
export function MobileRecord({
  lead, status, title, subtitle, meta, onClick, href,
}: {
  lead: React.ReactNode
  status?: React.ReactNode
  title: React.ReactNode
  subtitle?: React.ReactNode
  meta?: React.ReactNode
  onClick?: () => void
  href?: string
}) {
  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">{lead}</div>
        {status}
      </div>
      <p className="text-base font-medium text-ink mt-2 truncate">{title}</p>
      {subtitle && <p className="text-sm text-ink-2 mt-0.5 truncate">{subtitle}</p>}
      {meta && <div className="text-xs text-ink-3 mt-2">{meta}</div>}
    </>
  )
  const cls = `block w-full text-left px-4 py-4 min-h-[44px] transition-colors
               hover:bg-surface-2 active:bg-surface-3
               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ink/30`
  if (href) return <a href={href} className={cls}>{inner}</a>
  return <button type="button" onClick={onClick} className={cls}>{inner}</button>
}

/* ── Detail panel ────────────────────────────────────────────────────────
   A side panel on desktop keeps the list in view, so an administrator working
   through a queue does not lose their place on every record. On a phone there
   is no room for both, so it becomes the whole screen. */
export function DetailPanel({
  open, onClose, title, subtitle, actions, children,
}: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.activeElement as HTMLElement | null
    panel.current?.focus()
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      prev?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div onClick={onClose} aria-hidden="true"
        className="absolute inset-0 bg-ink/25 animate-fade-in" />
      <div
        ref={panel}
        role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : 'Details'}
        tabIndex={-1}
        className="relative w-full sm:max-w-[560px] h-full bg-surface sm:border-l border-line
                   flex flex-col outline-none animate-[slideIn_.22s_cubic-bezier(.32,.72,0,1)]">
        <header className="shrink-0 flex items-start gap-3 px-5 sm:px-6
                           pt-[max(1rem,env(safe-area-inset-top))] pb-4 border-b border-line">
          <div className="min-w-0 flex-1">
            <h2 className="t-title truncate">{title}</h2>
            {subtitle && <p className="text-sm text-ink-2 mt-0.5 truncate">{subtitle}</p>}
          </div>
          {actions}
          <button type="button" onClick={onClose} aria-label="Close"
            className="w-9 h-9 grid place-items-center rounded-lg text-ink-2 shrink-0
                       hover:bg-surface-2 hover:text-ink transition-colors
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30">
            <svg viewBox="0 0 20 20" className="w-4 h-4" aria-hidden="true">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 sm:px-6 py-5
                        pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
      <style jsx global>{`
        @keyframes slideIn { from { transform: translateX(16px); opacity: .6 } to { transform: none; opacity: 1 } }
        @media (prefers-reduced-motion: reduce) {
          @keyframes slideIn { from, to { transform: none; opacity: 1 } }
        }
      `}</style>
    </div>
  )
}

export function DetailSection({
  title, note, children, className,
}: { title: string; note?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx('pt-5 first:pt-0 mt-5 first:mt-0 border-t first:border-t-0 border-line', className)}>
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <h3 className="t-eyebrow">{title}</h3>
        {note && <span className="text-xs text-ink-3">{note}</span>}
      </div>
      {children}
    </section>
  )
}

/** Label/value pairs. Aligned on a column so values scan vertically. */
export function Facts({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(96px,auto)_1fr] gap-x-4 gap-y-2.5">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-sm text-ink-3">{k}</dt>
          <dd className="text-sm text-ink min-w-0 break-words">{v ?? <span className="text-ink-3">—</span>}</dd>
        </div>
      ))}
    </dl>
  )
}

/* ── Timeline ────────────────────────────────────────────────────────────
   Built only from timestamps that exist. A payment that never settled simply
   stops, and the stopping point is the information. Nothing is interpolated
   and no step is drawn with a time it does not have. */
export function Timeline({
  steps, incomplete,
}: {
  steps: { label: string; at: string; note?: string }[]
  /** Shown greyed at the end: where this payment has not got to. */
  incomplete?: string
}) {
  if (steps.length === 0 && !incomplete) return null
  return (
    <ol className="relative pl-5">
      <span aria-hidden="true" className="absolute left-[3.5px] top-2 bottom-2 w-px bg-line" />
      {steps.map((s, i) => (
        <li key={i} className="relative pb-4 last:pb-0">
          <span aria-hidden="true"
            className="absolute -left-5 top-[5px] w-2 h-2 rounded-full bg-accent ring-4 ring-surface" />
          <p className="text-sm text-ink">{s.label}</p>
          <p className="text-xs text-ink-3 mt-0.5 tnum">{s.at}{s.note ? ` · ${s.note}` : ''}</p>
        </li>
      ))}
      {incomplete && (
        <li className="relative">
          <span aria-hidden="true"
            className="absolute -left-5 top-[5px] w-2 h-2 rounded-full bg-surface-3 ring-4 ring-surface" />
          <p className="text-sm text-ink-3">{incomplete}</p>
        </li>
      )}
    </ol>
  )
}
