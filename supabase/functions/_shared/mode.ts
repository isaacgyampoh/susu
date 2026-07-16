/**
 * Dev payments must be an explicit choice, never an inference.
 *
 * The old rule was "no Paystack key -> mark it paid". That makes a missing
 * environment variable — a deploy slip, a rotated key, a typo — into free money
 * for anyone with an account. An absence must never unlock permissive
 * behaviour.
 *
 * So: dev payments require ALLOW_DEV_PAYMENTS=true, set deliberately. If
 * Paystack is unconfigured and that flag is not set, payment endpoints refuse
 * rather than pretend. Failing closed is the only safe direction when the
 * subject is money.
 */
export const paystackConfigured = () => !!Deno.env.get('PAYSTACK_SECRET_KEY')

export const devPaymentsAllowed = () =>
  Deno.env.get('ALLOW_DEV_PAYMENTS') === 'true' && !paystackConfigured()

/** null = proceed. A Response = stop and return it. */
export function paymentsUnavailable(req: Request, error: (m: string, s: number, r?: Request) => Response) {
  if (paystackConfigured() || devPaymentsAllowed()) return null
  console.error('payments: no PAYSTACK_SECRET_KEY and ALLOW_DEV_PAYMENTS is not true — refusing')
  return error('Payments are not available right now. Please contact your susu admin.', 503, req)
}
