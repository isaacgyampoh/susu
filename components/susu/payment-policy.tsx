import { AlertTriangle } from 'lucide-react'

/**
 * The payment policy, in one place.
 *
 * ────────────────────────────────────────────────────────────────────────
 * It appears before an application is submitted, before a registration fee is
 * paid, and in the member portal. Three copies of the wording would drift, and
 * a policy that says slightly different things in three places is worse than
 * one that says nothing — so there is one component and one sentence.
 *
 * `variant="strong"` is for the moments money is about to move. Everywhere
 * else it is a quiet reminder rather than a warning box.
 */

export const NO_REFUND =
  'All payments are non-refundable. This applies to registration fees, ' +
  'contributions and any other money sent to AbiSusus Group.'

export const AFFORDABILITY =
  'Please join only groups whose daily contribution you can comfortably afford.'

export function PaymentPolicy({
  variant = 'quiet',
  className,
}: { variant?: 'quiet' | 'strong'; className?: string }) {
  if (variant === 'strong') {
    return (
      <div
        role="note"
        className={`rounded-md border border-warning/40 bg-warning/5 p-3.5 ${className ?? ''}`}
      >
        <p className="flex items-start gap-2 text-sm font-medium text-ink">
          <AlertTriangle size={15} strokeWidth={2.2} className="text-warning shrink-0 mt-0.5" aria-hidden="true" />
          Payments are non-refundable
        </p>
        <p className="text-xs text-ink-2 mt-1.5 leading-relaxed">
          {NO_REFUND} {AFFORDABILITY}
        </p>
      </div>
    )
  }
  return (
    <p className={`text-xs text-ink-3 leading-relaxed ${className ?? ''}`}>
      {NO_REFUND} {AFFORDABILITY}
    </p>
  )
}
