'use client'
import { forwardRef } from 'react'
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { cx } from './util'
import { Spinner } from './spinner'

export type ButtonVariant =
  | 'primary'    // ink — the one obvious action on a screen
  | 'accent'     // brand green — money moving in the member's favour
  | 'outline'    // the common secondary
  | 'soft'       // tertiary, sits on a card
  | 'ghost'      // toolbar / row-level
  | 'danger'     // destructive, confirmed
  | 'dangerLine' // destructive, quiet until you mean it
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANT: Record<ButtonVariant, string> = {
  primary:    'btn-dark',
  accent:     'btn-accent',
  outline:    'btn-line',
  soft:       'btn-soft',
  ghost:      'btn-ghost',
  danger:     'btn-danger',
  dangerLine: 'btn-danger-line',
}
const SIZE: Record<ButtonSize, string> = { sm: 'btn-sm', md: '', lg: 'btn-lg' }

type Common = {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Renders a spinner and blocks interaction. Keeps its width so rows don't jump. */
  loading?: boolean
  icon?: LucideIcon
  iconRight?: LucideIcon
  full?: boolean
  className?: string
  children?: React.ReactNode
}

export function buttonClass({ variant = 'primary', size = 'md', full, className }: Common = {}) {
  return cx(VARIANT[variant], SIZE[size], full && 'w-full', className)
}

const ICON_SIZE: Record<ButtonSize, number> = { sm: 14, md: 15, lg: 17 }

function Inner({ loading, icon: Icon, iconRight: IconRight, size = 'md', children }: Common) {
  const s = ICON_SIZE[size]
  return (
    <>
      {/* The label is hidden rather than replaced, so the button keeps its
          width and neighbouring controls do not shift while a request runs. */}
      {loading && (
        <span className="absolute inset-0 grid place-items-center">
          <Spinner size={s + 2} />
        </span>
      )}
      <span className={cx('inline-flex items-center gap-1.5', loading && 'invisible')}>
        {Icon && <Icon size={s} strokeWidth={2.2} className="shrink-0" aria-hidden="true" />}
        {children}
        {IconRight && <IconRight size={s} strokeWidth={2.2} className="shrink-0" aria-hidden="true" />}
      </span>
    </>
  )
}

export type ButtonProps = Common & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'className'>

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size = 'md', loading, icon, iconRight, full, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref} type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass({ variant, size, full, className })}
      {...rest}
    >
      <Inner loading={loading} icon={icon} iconRight={iconRight} size={size}>{children}</Inner>
    </button>
  )
})

export type ButtonLinkProps = Common &
  Omit<React.ComponentProps<typeof Link>, 'children' | 'className'>

/** Same shape as Button, but it navigates. Use for anything that changes URL. */
export function ButtonLink({
  variant, size = 'md', icon, iconRight, full, className, children, ...rest
}: ButtonLinkProps) {
  return (
    <Link className={buttonClass({ variant, size, full, className })} {...rest}>
      <Inner icon={icon} iconRight={iconRight} size={size}>{children}</Inner>
    </Link>
  )
}

/** Square, label-free control. `label` is required — it becomes the a11y name. */
export function IconButton({
  icon: Icon, label, variant = 'ghost', size = 'md', className, ...rest
}: { icon: LucideIcon; label: string } & Omit<ButtonProps, 'icon' | 'children'>) {
  return (
    <button
      type="button" aria-label={label} title={label}
      className={cx(buttonClass({ variant, size, className }), 'btn-icon')}
      {...rest}
    >
      <Icon size={ICON_SIZE[size] + 2} strokeWidth={2.1} aria-hidden="true" />
    </button>
  )
}
