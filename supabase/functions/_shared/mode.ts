import { naloConfigured } from './nalo.ts'

/**
 * Which payment provider is live, and is it safe to take money?
 *
 * NaloPay is the only provider. Moolre and Paystack were removed once the
 * business settled on Nalo — carrying three half-exercised payment paths was
 * a liability, since a bug could hide in the two nobody ever ran.
 *
 * The rule that matters: dev payments are an explicit choice, never an
 * inference. A missing key must never become free contributions.
 */
export type Provider = 'nalo' | 'none'

export function provider(): Provider {
  return naloConfigured() ? 'nalo' : 'none'
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
