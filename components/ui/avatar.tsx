import { cx } from './util'

/**
 * Initials avatar. Deterministic tint from the name so the same member is the
 * same colour on every screen — in a list of forty rows that is a real aid to
 * finding someone again, and it costs nothing.
 *
 * The tints are all light backgrounds with dark ink on top, so contrast never
 * depends on which one a name happens to land on.
 */
const TINTS = [
  'bg-accent-soft text-accent',
  'bg-info-soft text-info',
  'bg-warning-soft text-warning',
  'bg-danger-soft text-danger',
  'bg-surface-3 text-ink-2',
] as const

function initials(name?: string | null) {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

function hash(s: string) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

const SIZE = {
  sm: 'w-7 h-7 text-2xs rounded-sm',
  md: 'w-9 h-9 text-xs rounded-md',
  lg: 'w-11 h-11 text-sm rounded-lg',
} as const

export function Avatar({
  name, size = 'md', tone, className,
}: {
  name?: string | null
  size?: keyof typeof SIZE
  /** `ink` for the member's own avatar — it should not look like a row in a list. */
  tone?: 'ink'
  className?: string
}) {
  const tint = tone === 'ink' ? 'bg-ink text-inverse' : TINTS[hash(name ?? '') % TINTS.length]
  return (
    <span
      aria-hidden="true"
      className={cx('grid place-items-center font-bold shrink-0 select-none', SIZE[size], tint, className)}
    >
      {initials(name)}
    </span>
  )
}
