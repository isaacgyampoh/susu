'use client'
import { forwardRef, useId } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cx } from './util'

/* ---------------------------------------------------------------------------
   Every input in this app is wrapped by Field. That is what guarantees a real
   <label for>, a described-by hint, and an error that screen readers announce —
   none of which the raw markup this replaced had.
   ------------------------------------------------------------------------ */

type FieldProps = {
  label?: React.ReactNode
  hint?: React.ReactNode
  error?: string | null
  required?: boolean
  /** Right-aligned affordance on the label row, e.g. a "Show" toggle. */
  aside?: React.ReactNode
  className?: string
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => React.ReactNode
}

export function Field({ label, hint, error, required, aside, className, children }: FieldProps) {
  const uid = useId()
  const id = `f${uid}`
  const hintId = hint ? `${id}-hint` : undefined
  const errId  = error ? `${id}-err` : undefined
  const describedBy = [errId, hintId].filter(Boolean).join(' ') || undefined

  return (
    <div className={cx('min-w-0', className)}>
      {(label || aside) && (
        <div className="flex items-baseline justify-between gap-3 mb-1.5">
          {label && (
            <label htmlFor={id} className="text-sm font-medium text-ink-2">
              {label}
              {required && <span className="text-danger ml-0.5" aria-hidden="true">*</span>}
            </label>
          )}
          {aside}
        </div>
      )}
      {children({ id, describedBy, invalid: !!error })}
      {error && (
        <p id={errId} className="text-xs text-danger mt-1.5 font-medium">{error}</p>
      )}
      {hint && !error && (
        <p id={hintId} className="text-xs text-ink-3 mt-1.5 leading-relaxed">{hint}</p>
      )}
    </div>
  )
}

/* ---- Controls ----------------------------------------------------------- */

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean
  /** Leading glyph — search, phone, and so on. Reserves 36px of padding. */
  icon?: LucideIcon
  /** Fixed leading text, e.g. the currency on a money field. */
  prefix?: string
  mono?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid, icon: Icon, prefix, mono, className, ...rest }, ref,
) {
  const field = (
    <input
      ref={ref}
      aria-invalid={invalid || undefined}
      className={cx(
        'in', invalid && 'in-invalid',
        mono && 'font-mono tracking-tight',
        Icon && 'pl-9', prefix && 'pl-[3.25rem]',
        className,
      )}
      {...rest}
    />
  )
  if (!Icon && !prefix) return field
  return (
    <div className="relative">
      {Icon && (
        <Icon size={16} strokeWidth={2.1} aria-hidden="true"
          className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" />
      )}
      {prefix && (
        <span aria-hidden="true"
          className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-ink-3 pointer-events-none">
          {prefix}
        </span>
      )}
      {field}
    </div>
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ invalid, className, ...rest }, ref) {
    return (
      <textarea ref={ref} aria-invalid={invalid || undefined}
        className={cx('in-area', invalid && 'in-invalid', className)} {...rest} />
    )
  },
)

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ invalid, className, children, ...rest }, ref) {
    return (
      <select ref={ref} aria-invalid={invalid || undefined}
        className={cx('in-select', invalid && 'in-invalid', className)} {...rest}>
        {children}
      </select>
    )
  },
)

/**
 * Checkbox and Radio ship as whole rows, not bare boxes. A tick with an
 * unclickable label beside it is the single most common form bug, and the
 * bordered "selected" state is what makes a choice readable at a glance on a
 * phone.
 */
type ChoiceProps = {
  label: React.ReactNode
  hint?: React.ReactNode
  /** Draws it as a bordered, selectable card rather than a plain row. */
  boxed?: boolean
  className?: string
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'>

function Choice({ type, label, hint, boxed, className, checked, disabled, ...rest }: ChoiceProps & { type: 'checkbox' | 'radio' }) {
  return (
    <label
      className={cx(
        'flex items-start gap-2.5 cursor-pointer group',
        boxed && 'p-3 rounded-md border transition-colors',
        boxed && (checked ? 'border-ink bg-surface-2' : 'border-line hover:border-ink/25'),
        disabled && 'opacity-50 cursor-not-allowed',
        className,
      )}
    >
      <input
        type={type} checked={checked} disabled={disabled}
        className={cx(type === 'checkbox' ? 'in-check' : 'in-radio', 'mt-0.5')}
        {...rest}
      />
      <span className="min-w-0 flex-1">
        <span className="block text-base text-ink leading-snug">{label}</span>
        {hint && <span className="block text-xs text-ink-3 mt-0.5 leading-relaxed">{hint}</span>}
      </span>
    </label>
  )
}

export const Checkbox = (p: ChoiceProps) => <Choice type="checkbox" {...p} />
export const Radio    = (p: ChoiceProps) => <Choice type="radio"    {...p} />

/** Switch for a setting that applies immediately (no Save button follows it). */
export function Toggle({
  checked, onChange, label, hint, disabled, id: idProp,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: React.ReactNode
  hint?: React.ReactNode
  disabled?: boolean
  id?: string
}) {
  const uid = useId()
  const id = idProp ?? `t${uid}`
  return (
    <div className={cx('flex items-start justify-between gap-4', disabled && 'opacity-50')}>
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-base font-medium text-ink">{label}</span>
        {hint && <span className="block text-xs text-ink-2 mt-0.5 leading-relaxed">{hint}</span>}
      </label>
      <button
        id={id} type="button" role="switch" aria-checked={checked} disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative shrink-0 w-11 h-6 rounded-full transition-colors duration-200 mt-0.5',
          checked ? 'bg-accent' : 'bg-surface-3',
          !disabled && 'cursor-pointer',
        )}
      >
        <span className={cx(
          'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-surface shadow-sm transition-transform duration-200 ease-out',
          checked && 'translate-x-5',
        )} />
      </button>
    </div>
  )
}

/** Grouping wrapper so long forms have visible structure instead of a wall. */
export function FieldSet({
  legend, hint, className, children,
}: { legend?: React.ReactNode; hint?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <fieldset className={cx('min-w-0', className)}>
      {legend && <legend className="t-eyebrow mb-1">{legend}</legend>}
      {hint && <p className="text-xs text-ink-3 mb-3 leading-relaxed">{hint}</p>}
      <div className={cx('space-y-4', legend && !hint && 'mt-3')}>{children}</div>
    </fieldset>
  )
}
