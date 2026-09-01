import type { Money } from '../../domain/shared/money'

/**
 * The payment provider port.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The live provider is NALOPAY. It is the only one — `_shared/mode.ts` records
 * that Moolre and Paystack were deliberately removed once the business settled
 * on Nalo, "since a bug could hide in the two nobody ever ran". That reasoning
 * holds and this interface does not reintroduce them.
 *
 * A LEGACY NAMING NOTE, not a rename: the database still calls its columns
 * `paystack_ref`, `paystack_data` and `paystack_transfer_ref`, and the
 * `transactions` table is keyed on them. Those names are archaeology from a
 * provider that is gone. They are NOT renamed here and must not be renamed
 * casually — `contributions.paystack_ref` is the column at the centre of
 * finding F-02, several settlement paths write it, and a unique index may or
 * may not exist on it in production. Any rename waits for the Phase 01 output
 * and gets its own migration.
 *
 * What this interface describes is business capability, not Nalo's wire
 * format. Nothing about order ids, channel codes, USSD strings or the fact
 * that MTN is channel 13 when collecting and 1 when paying out belongs here.
 * All of that lives in `src/infrastructure/payments/nalopay/`.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Ghanaian mobile money networks, in business terms. */
export type MobileMoneyNetwork = 'MTN' | 'TELECEL' | 'AIRTELTIGO'

export interface PaymentRequest {
  /** The wallet to debit. */
  readonly payerNumber: string
  readonly network: MobileMoneyNetwork
  /** What the wallet is actually charged — contribution plus service charge. */
  readonly amount: Money
  /** Our reference. The provider echoes it back or gives us its own. */
  readonly reference: string
  /** Shown to the payer where the provider supports it. */
  readonly description: string
  readonly payerName?: string
}

/**
 * The provider's answer to "please collect this".
 *
 * `prompted` and `otpRequired` are both NORMAL. Some networks insert an SMS
 * code before the PIN prompt; that is a step in the flow, not a failure, and
 * modelling it as an error is what made the old code treat a working payment
 * as a broken one.
 */
export type PaymentRequestResult =
  | {
      readonly kind: 'prompted'
      /** The provider's own identity for this collection, if it issued one. */
      readonly providerReference: string | null
      /** A USSD string the payer may need to dial. */
      readonly ussd?: string
      readonly message: string
    }
  | { readonly kind: 'otp-required'; readonly message: string }
  | { readonly kind: 'duplicate';    readonly message: string }
  | { readonly kind: 'failed';       readonly message: string }

/**
 * The provider's answer to "did this actually complete".
 *
 * `pending` is distinct from `failed` on purpose. The provider's status
 * endpoint lags — it reports pending for a while after money has moved — so
 * treating "not yet confirmed" as "did not happen" is wrong, and treating an
 * unverifiable callback as confirmation is worse. That confusion is finding
 * F-04, where a forged callback could settle a payment that never occurred.
 */
export type PaymentStatusResult =
  | {
      readonly kind: 'settled'
      /** What the provider says was ACTUALLY collected. */
      readonly amount: Money
      readonly providerReference: string
      readonly raw: unknown
    }
  | { readonly kind: 'pending'; readonly message: string }
  | { readonly kind: 'failed';  readonly message: string; readonly raw: unknown }
  | { readonly kind: 'unknown'; readonly message: string }

export interface PaymentProvider {
  readonly name: string

  /** Ask the provider to collect. Raises a prompt on the payer's phone. */
  createPayment(request: PaymentRequest): Promise<PaymentRequestResult>

  /**
   * Ask the provider what happened. THIS, never a callback body, is what may
   * settle a payment.
   */
  verifyPayment(providerReference: string): Promise<PaymentStatusResult>

  /** Submit an SMS code where the network demanded one first. */
  submitOtp(providerReference: string, otp: string): Promise<PaymentRequestResult>

  /**
   * Extract the reference from a callback payload, and nothing else.
   *
   * The return type deliberately carries no notion of success. A callback here
   * is unsigned and therefore a RUMOUR: it may tell us which payment to look
   * at, and the answer must then come from `verifyPayment`. Modelling it as
   * anything richer is how the current webhook ends up trusting the body.
   */
  parseCallback(payload: unknown): { readonly providerReference: string | null }
}

/** Notifications, so the domain and use cases never import an SMS SDK. */
export interface NotificationProvider {
  readonly name: string
  sendToMember(phone: string, message: string): Promise<{ delivered: boolean; error?: string }>
  notifyOperators(message: string): Promise<void>
}

/**
 * The clock, as a dependency.
 *
 * The domain takes `asOf` as an argument so it stays pure and testable. This
 * is where that value comes from in production — and it is injectable, so a
 * test can freeze the day without touching the domain at all.
 */
export interface Clock {
  /** `YYYY-MM-DD` in the operating timezone. */
  today(): string
  /** ISO 8601 instant. */
  now(): string
}
