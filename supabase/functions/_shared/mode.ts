import { moolreConfigured } from './moolre.ts'

/**
 * Which payment provider is live, and is it safe to take money?
 *
 * The rule that matters: dev payments are an explicit choice, never an
 * inference. A missing key must never become free contributions.
 */
export type Provider = 'moolre' | 'paystack' | 'none'

export const paystackConfigured = () => !!Deno.env.get('PAYSTACK_SECRET_KEY')

export function provider(): Provider {
  const pick = (Deno.env.get('PAYMENT_PROVIDER') ?? '').toLowerCase()
  if (pick === 'moolre'   && moolreConfigured())   return 'moolre'
  if (pick === 'paystack' && paystackConfigured()) return 'paystack'
  // Nothing chosen: use whatever is actually configured, Moolre first.
  if (moolreConfigured())   return 'moolre'
  if (paystackConfigured()) return 'paystack'
  return 'none'
}

export const devPaymentsAllowed = () =>
  Deno.env.get('ALLOW_DEV_PAYMENTS') === 'true' && provider() === 'none'

/** null = carry on. A Response = stop. */
export function paymentsUnavailable(req: Request, error: (m: string, s: number, r?: Request) => Response) {
  if (provider() !== 'none' || devPaymentsAllowed()) return null
  console.error('payments: no provider configured and ALLOW_DEV_PAYMENTS is not true — refusing')
  return error('Payments are not available right now. Please contact your susu admin.', 503, req)
}
