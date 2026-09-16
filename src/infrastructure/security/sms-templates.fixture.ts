/**
 * The two credential-bearing SMS templates, copied verbatim.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * `_shared/africas-talking.ts` reads `Deno.env` at module load, so the test
 * runner cannot import it. Rather than test redaction against invented strings
 * that may drift from the real ones, the real templates are mirrored here and
 * pinned to the source by `templates stay in step with the real module` in
 * redact.test.ts — if somebody edits the wording in the edge module, that test
 * fails rather than the redaction quietly stopping to match.
 */
export const smsTemplates = {
  welcome: (name: string, memberId: string, passcode: string, portalUrl: string) =>
    `Hello ${name}, your Abbie Wealth Susu account is ready. ID: ${memberId} | Passcode: ${passcode} | Sign in: ${portalUrl} | Pay before 6:00 PM daily. Keep your passcode private.`,
  applicationApproved: (name: string, memberId: string, passcode: string, portalUrl: string) =>
    `Hello ${name}, your Abbie Wealth Susu application is approved. ID: ${memberId} | Passcode: ${passcode} | Sign in: ${portalUrl} | Keep your passcode private.`,
  paymentConfirmed: (name: string, amount: string, ref: string) =>
    `Hi ${name}, we've received your Abbie Wealth Susu payment of GHS ${amount}. Your contribution is recorded. Ref: ${ref}. Thank you!`,
}
