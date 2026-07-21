import { moolreConfigured } from './moolre.ts'
import { naloConfigured } from './nalo.ts'

/**
 * Which payment provider is live, and is it safe to take money?
 *
 * The rule that matters: dev payments are an explicit choice, never an
 * inference. A missing key must never become free contributions.
 */
export type Provider = 'nalo' | 'moolre' | 'paystack' | 'none'

export const paystackConfigured = () => !!Deno.env.get('PAYSTACK_SECRET_KEY')

export function provider(): Provider {
  const pick = (Deno.env.get('PAYMENT_PROVIDER') ?? '').toLowerCase()
  if (pick === 'nalo'     && naloConfigured())     return 'nalo'
  if (pick === 'moolre'   && moolreConfigured())   return 'moolre'
  if (pick === 'paystack' && paystackConfigured()) return 'paystack'
  // Nothing chosen: use whatever is actually configured, Nalo first.
  if (naloConfigured())     return 'nalo'
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

/**
 * Service charge passed to the customer. The member's contribution is recorded
 * at its true value; the amount actually CHARGED via the provider is grossed up
 * by this percentage so the operator doesn't absorb the MoMo fee.
 * Configure PAYMENT_SERVICE_CHARGE_PCT (e.g. "1.5"); defaults to 1.5%.
 */
export const serviceChargePct = () => {
  const v = Number(Deno.env.get('PAYMENT_SERVICE_CHARGE_PCT') ?? '1.5')
  return isNaN(v) || v < 0 ? 0 : v
}

/** Gross up a contribution amount by the service charge, rounded to 2dp. */
export function withServiceCharge(amount: number): { charged: number; fee: number } {
  const fee = Math.round(amount * (serviceChargePct() / 100) * 100) / 100
  return { charged: Math.round((amount + fee) * 100) / 100, fee }
}
