'use client'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { cx } from '@/components/ui'

/* ---------------------------------------------------------------------------
   THE MEMBER APPLICATION'S HEADER

   Two variants, because a phone application has two kinds of screen and a
   webpage has one.

   `hero`  — the home screen. A dark band that runs to the top edge of the
             device and carries the account's headline figure, the way a
             banking app opens on a balance rather than on a menu. The status
             bar sits inside it, which is what makes the app look physically
             designed for the phone rather than pasted into it.

   `plain` — every other screen. Compact: a title, a back affordance, and no
             more height than those need. A sub-page that opens with a 200px
             header is a webpage.

   Both take their top padding from `env(safe-area-inset-top)`, so content
   clears a notch or a Dynamic Island instead of hiding under it.
   ------------------------------------------------------------------------ */

export function AppBar({
  variant = 'plain', title, back, right, children, className,
}: {
  variant?: 'hero' | 'plain'
  title?: React.ReactNode
  back?: { href: string; label: string }
  right?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  if (variant === 'hero') {
    return (
      <header className={cx(
        'relative bg-[#0C0E12] text-white overflow-hidden app-grain',
        'pt-[max(1.25rem,calc(env(safe-area-inset-top)+0.75rem))] pb-7',
        className,
      )}>
        <div className="portal-w relative">
          <div className="flex items-center justify-between gap-3">
            {/* The wordmark carries the brand on its own. A small ring icon
                beside it was decoration doing no work. */}
            <span className="font-display font-bold text-[17px] tracking-[-.02em] leading-none">
              Abbie&nbsp;Wealth
            </span>
            {right}
          </div>
          {children}
        </div>
      </header>
    )
  }

  return (
    <header className={cx(
      'sticky top-0 z-30 bg-surface/90 backdrop-blur-xl border-b border-line',
      'pt-[max(0.75rem,env(safe-area-inset-top))]',
      className,
    )}>
      <div className="portal-w flex items-center gap-2 h-12">
        {back && (
          <Link href={back.href} aria-label={back.label}
            className="-ml-2 w-9 h-9 grid place-items-center rounded-lg text-ink-2 shrink-0
                       hover:bg-surface-2 hover:text-ink transition-colors
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30">
            <ChevronLeft size={19} strokeWidth={2.2} aria-hidden="true" />
          </Link>
        )}
        <h1 className="font-display text-lg font-semibold text-ink tracking-[-.015em] truncate flex-1">
          {title}
        </h1>
        {right}
      </div>
    </header>
  )
}

/* ── The account headline ────────────────────────────────────────────────
   One figure with the weight, and the numbers that qualify it set quietly
   beneath a rule. Not three equal cards: a member opening this wants one
   answer first, and the others in support of it. */
export function AccountHero({
  greeting, name, label, figure, note, stats,
}: {
  greeting: string
  name: string
  label: string
  figure: React.ReactNode
  note?: React.ReactNode
  stats: { label: string; value: React.ReactNode; tone?: 'warn' | 'good' }[]
}) {
  return (
    <>
      <p className="mt-7 text-sm text-white/55">{greeting},</p>
      <p className="font-display text-xl font-semibold tracking-[-.02em] mt-0.5 truncate">{name}</p>

      <p className="t-eyebrow !text-white/40 mt-7 mb-2">{label}</p>
      <div className="font-display text-[38px] leading-none font-semibold tracking-[-.03em] tnum">
        {figure}
      </div>
      {note && <p className="text-sm text-white/50 mt-2">{note}</p>}

      {stats.length > 0 && (
        <dl className="grid grid-cols-3 gap-x-4 mt-7 pt-5 border-t border-white/10">
          {stats.map(s => (
            <div key={s.label} className="min-w-0">
              <dt className="text-2xs font-medium uppercase tracking-[.07em] text-white/40 truncate">
                {s.label}
              </dt>
              <dd className={cx(
                'text-md font-semibold tnum mt-1.5 truncate',
                s.tone === 'warn' ? 'text-[#F0BE7A]' : s.tone === 'good' ? 'text-[#A7DCC4]' : 'text-white',
              )}>{s.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </>
  )
}

/* ── Quick actions ───────────────────────────────────────────────────────
   A row of destinations, not a grid of coloured tiles. Each is a ≥44px target
   with a label — an icon alone does not tell a first-time member what
   "Statement" means. */
export function QuickActions({
  actions,
}: { actions: { href: string; label: string; icon: React.ElementType; onClick?: () => void }[] }) {
  return (
    <nav aria-label="Quick actions"
      className="grid grid-cols-4 gap-2 border-y border-line bg-surface">
      {actions.map(({ href, label, icon: Icon, onClick }) => {
        const inner = (
          <>
            <Icon size={19} strokeWidth={1.9} aria-hidden="true" className="text-ink-2" />
            <span className="text-2xs font-medium text-ink-2">{label}</span>
          </>
        )
        const cls = `flex flex-col items-center justify-center gap-1.5 min-h-[64px] py-3
                     transition-colors hover:bg-surface-2 active:bg-surface-3
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset
                     focus-visible:ring-ink/30`
        return onClick
          ? <button key={label} type="button" onClick={onClick} className={cls}>{inner}</button>
          : <Link key={label} href={href} className={cls}>{inner}</Link>
      })}
    </nav>
  )
}
