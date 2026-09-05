import { cx } from './util'

/* ---------------------------------------------------------------------------
   Status vocabulary.

   Every state string this system produces is mapped here, once. Previously
   each screen had its own `statusBadge()` and they disagreed — `pending` was
   amber on Members, grey on Contributions, and unstyled on Payouts because the
   colour it asked for had been deleted from the theme.

   Tone never carries the meaning alone: the word is always present, and each
   tone also differs in border and weight, so this survives being printed in
   black and white or read by someone who cannot separate red from green.
   ------------------------------------------------------------------------ */

export type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'strong' | 'off'

const TONE: Record<Tone, string> = {
  neutral: 'pill-neutral',
  good:    'pill-good',
  warn:    'pill-warn',
  bad:     'pill-bad',
  info:    'pill-info',
  strong:  'pill-on',
  off:     'pill-off',
}

export function Badge({
  tone = 'neutral', dot, children, className,
}: { tone?: Tone; dot?: boolean; children: React.ReactNode; className?: string }) {
  return (
    <span className={cx(TONE[tone], className)}>
      {dot && <StatusDot tone={tone} />}
      {children}
    </span>
  )
}

export function StatusDot({ tone = 'neutral', className }: { tone?: Tone; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'w-1.5 h-1.5 rounded-full shrink-0',
        tone === 'good' && 'bg-success',
        tone === 'warn' && 'bg-warning',
        tone === 'bad' && 'bg-danger',
        tone === 'info' && 'bg-info',
        tone === 'strong' && 'bg-inverse',
        (tone === 'neutral' || tone === 'off') && 'bg-ink-3',
        className,
      )}
    />
  )
}

/** Every status string the API returns, and how it should read. */
const MAP: Record<string, { tone: Tone; label: string }> = {
  // members
  active:      { tone: 'good',    label: 'Active' },
  pending:     { tone: 'warn',    label: 'Pending' },
  suspended:   { tone: 'bad',     label: 'Suspended' },
  removed:     { tone: 'off',     label: 'Removed' },
  // groups
  open:        { tone: 'info',    label: 'Open' },
  full:        { tone: 'warn',    label: 'Full' },
  completed:   { tone: 'off',     label: 'Completed' },
  // contributions
  paid:        { tone: 'good',    label: 'Paid' },
  overdue:     { tone: 'bad',     label: 'Overdue' },
  due:         { tone: 'warn',    label: 'Due' },
  // payouts
  upcoming:    { tone: 'neutral', label: 'Upcoming' },
  processing:  { tone: 'info',    label: 'Processing' },
  // kyc / transactions
  approved:    { tone: 'good',    label: 'Approved' },
  rejected:    { tone: 'bad',     label: 'Rejected' },
  success:     { tone: 'good',    label: 'Successful' },
  failed:      { tone: 'bad',     label: 'Failed' },
  // A settled payment whose allocations were later reversed. Distinct from
  // 'failed': the money arrived, and was then given back its days.
  reversed:    { tone: 'warn',    label: 'Reversed' },
  // A person decided this money is not coming. Distinct from 'failed', which
  // in this system means the provider said the payment did not complete.
  written_off: { tone: 'neutral', label: 'Written off' },
  // memberships
  defaulted:   { tone: 'bad',     label: 'Defaulted' },
}

/** `<Status value={member.status} />` — one source of truth for tone and wording. */
export function Status({ value, className }: { value?: string | null; className?: string }) {
  if (!value) return null
  const m = MAP[value] ?? { tone: 'neutral' as Tone, label: value }
  return <Badge tone={m.tone} className={cx('capitalize', className)}>{m.label}</Badge>
}

/** Inline notice — the calm sibling of a toast, for state that persists on the page. */
export function Notice({
  tone = 'info', title, children, action, className,
}: {
  tone?: 'info' | 'warn' | 'bad' | 'good'
  title?: React.ReactNode
  children?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      role={tone === 'bad' ? 'alert' : 'status'}
      className={cx(
        'rounded-md border p-3.5 flex items-start justify-between gap-3',
        tone === 'info' && 'bg-info-soft border-info-line',
        tone === 'warn' && 'bg-warning-soft border-warning-line',
        tone === 'bad'  && 'bg-danger-soft border-danger-line',
        tone === 'good' && 'bg-success-soft border-success-line',
        className,
      )}
    >
      <div className="min-w-0">
        {title && (
          <p className={cx(
            'text-sm font-semibold',
            tone === 'info' && 'text-info', tone === 'warn' && 'text-warning',
            tone === 'bad' && 'text-danger', tone === 'good' && 'text-success',
          )}>{title}</p>
        )}
        {children && (
          <div className={cx('text-xs text-ink-2 leading-relaxed', title && 'mt-1')}>{children}</div>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
