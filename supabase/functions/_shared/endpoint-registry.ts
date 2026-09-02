/**
 * WHAT EVERY ENDPOINT DOES TO THE WORLD.
 *
 * ════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS
 *
 * During an endpoint audit, `cron-daily-reminders` was invoked manually with a
 * valid admin token. It did exactly what it is built to do: it sent 66 real
 * SMS messages and raised 65 real NaloPay payment prompts — about GHS 5,350 of
 * payment intents — to real members, outside the 07:00 schedule.
 *
 * Nothing was broken. Authorization worked, the job worked, the audit tool
 * worked. The failure was that the audit tool had no way to know the
 * difference between an endpoint that ANSWERS a question and an endpoint that
 * CHARGES A CUSTOMER, so it treated "admin-authorized" as "safe to call".
 *
 * Authorization tells you whether a caller is ALLOWED to do a thing. It says
 * nothing about whether doing it is a good idea. This file supplies the part
 * that was missing.
 *
 * ── HOW IT IS USED ──────────────────────────────────────────────────────
 *
 * Automated tooling asks `isSafeToProbe(name)` and, unless a human has opted
 * in explicitly, calls nothing else. The default is refusal: an endpoint that
 * is not listed here is treated as DANGEROUS, so adding a new function without
 * classifying it fails closed rather than open. `endpoint-registry.test.ts`
 * enforces that every deployed function appears below.
 *
 * This does not gate production. The real scheduler still calls the real jobs
 * exactly as before — the guard belongs in the tooling that probes, not in the
 * path that serves.
 * ════════════════════════════════════════════════════════════════════════
 */

export type Effect =
  | 'READ_ONLY'            // answers a question; changes nothing
  | 'FINANCIAL_MUTATION'   // moves money, allocations, credit or payouts
  | 'EXTERNAL_PAYMENT'     // asks NaloPay to charge a real customer
  | 'SMS_NOTIFICATION'     // sends a real SMS to a real phone
  | 'STORAGE_MUTATION'     // writes or deletes stored documents
  | 'ADMIN_MUTATION'       // changes members, groups, KYC or configuration
  | 'SCHEDULED_MUTATION'   // designed to be driven by cron, not by hand

export const ENDPOINTS: Record<string, Effect[]> = {
  // ── Answers only. Safe for an automated probe. ────────────────────────
  'admin-analytics':           ['READ_ONLY'],
  'admin-audit':               ['READ_ONLY'],
  'admin-dashboard':           ['READ_ONLY'],
  'admin-paid-today':          ['READ_ONLY'],
  'admin-reports':             ['READ_ONLY'],
  'admin-sms-log':             ['READ_ONLY'],
  'admin-transactions':        ['READ_ONLY'],
  'admin-payments':            ['READ_ONLY'],
  'contributions-list':        ['READ_ONLY'],
  'groups-public':             ['READ_ONLY'],
  'member-profile':            ['READ_ONLY'],
  'member-statement':          ['READ_ONLY'],
  'payments-preview':          ['READ_ONLY'],
  // Retired in Phase 04; answers 410 and touches nothing.
  'admin-reconcile-payments':  ['READ_ONLY'],

  // ── Charges a real customer through NaloPay. Never probe. ─────────────
  // admin-payment-test fires a genuine MoMo prompt at a real phone. Its own
  // header says "the money is real"; it is not a health check.
  'admin-payment-test':        ['EXTERNAL_PAYMENT'],
  'payments-initialize':       ['EXTERNAL_PAYMENT', 'FINANCIAL_MUTATION'],
  'payments-bulk':             ['EXTERNAL_PAYMENT', 'FINANCIAL_MUTATION'],
  'payments-otp':              ['EXTERNAL_PAYMENT'],
  'payments-verify':           ['EXTERNAL_PAYMENT', 'FINANCIAL_MUTATION', 'SMS_NOTIFICATION'],
  'registration-payment':      ['EXTERNAL_PAYMENT', 'FINANCIAL_MUTATION'],

  // ── Provider callbacks. They settle money; only the provider calls them.
  'nalo-webhook':              ['FINANCIAL_MUTATION', 'EXTERNAL_PAYMENT', 'SMS_NOTIFICATION'],
  'payments-webhook':          ['FINANCIAL_MUTATION'],
  'moolre-webhook':            ['FINANCIAL_MUTATION'],

  // ── Money, moved by an administrator. ─────────────────────────────────
  'payments-manual':           ['FINANCIAL_MUTATION', 'SMS_NOTIFICATION'],
  'admin-undo-payment':        ['FINANCIAL_MUTATION', 'ADMIN_MUTATION'],
  'admin-repair-overpayments': ['FINANCIAL_MUTATION', 'ADMIN_MUTATION'],
  'admin-repair-forced':       ['FINANCIAL_MUTATION', 'ADMIN_MUTATION'],
  'admin-restore-reversals':   ['FINANCIAL_MUTATION', 'ADMIN_MUTATION', 'SMS_NOTIFICATION'],
  'admin-reconciliation':      ['FINANCIAL_MUTATION', 'EXTERNAL_PAYMENT', 'ADMIN_MUTATION'],
  'payouts-admin':             ['FINANCIAL_MUTATION', 'ADMIN_MUTATION', 'SMS_NOTIFICATION'],
  'admin-forfeit':             ['FINANCIAL_MUTATION', 'ADMIN_MUTATION', 'SMS_NOTIFICATION'],

  // ── Scheduled jobs. The reason this file exists. ──────────────────────
  'cron-daily-reminders':      ['SCHEDULED_MUTATION', 'EXTERNAL_PAYMENT', 'SMS_NOTIFICATION', 'FINANCIAL_MUTATION'],
  'cron-settle-pending':       ['SCHEDULED_MUTATION', 'FINANCIAL_MUTATION', 'EXTERNAL_PAYMENT', 'SMS_NOTIFICATION'],
  'cron-daily-digest':         ['SCHEDULED_MUTATION', 'SMS_NOTIFICATION'],
  'cron-payout-reminders':     ['SCHEDULED_MUTATION', 'SMS_NOTIFICATION'],
  'flag-late-payments':        ['SCHEDULED_MUTATION', 'ADMIN_MUTATION', 'SMS_NOTIFICATION'],

  // ── Sends a real SMS to a real person. ────────────────────────────────
  'announcements':             ['SMS_NOTIFICATION'],
  'admin-send-invites':        ['SMS_NOTIFICATION', 'ADMIN_MUTATION'],
  'contact-admin':             ['SMS_NOTIFICATION'],

  // ── Changes people, groups or configuration. ──────────────────────────
  'admin-add-member':          ['ADMIN_MUTATION', 'SMS_NOTIFICATION', 'FINANCIAL_MUTATION'],
  'admin-onboard-member':      ['ADMIN_MUTATION', 'SMS_NOTIFICATION'],
  'admin-members':             ['ADMIN_MUTATION', 'SMS_NOTIFICATION'],
  'admin-contacts':            ['ADMIN_MUTATION'],
  'groups-create':             ['ADMIN_MUTATION'],
  'groups-activate':           ['ADMIN_MUTATION', 'SMS_NOTIFICATION'],
  'kyc-review':                ['ADMIN_MUTATION', 'FINANCIAL_MUTATION', 'SMS_NOTIFICATION'],
  'member-join-group':         ['ADMIN_MUTATION'],

  // ── Documents. ────────────────────────────────────────────────────────
  'kyc-submit':                ['STORAGE_MUTATION', 'ADMIN_MUTATION', 'SMS_NOTIFICATION'],
  // Mints a signed URL and writes an access-log row. Reading somebody's
  // national ID is a privileged act and leaves a trace, so it is not READ_ONLY.
  'admin-document':            ['STORAGE_MUTATION'],

  // ── Credentials. Probing these burns real lockout budget. ─────────────
  'auth-admin-login':          ['ADMIN_MUTATION'],
  'auth-member-login':         ['ADMIN_MUTATION'],
  'admin-change-password':     ['ADMIN_MUTATION'],
  'member-change-passcode':    ['ADMIN_MUTATION', 'SMS_NOTIFICATION'],
}

/** The only classification an automated probe may call unattended. */
export function isSafeToProbe(name: string): boolean {
  const effects = ENDPOINTS[name]
  // Unknown endpoint → dangerous. Adding a function must not silently opt it
  // into being probed; it must fail closed until somebody classifies it.
  if (!effects) return false
  return effects.length === 1 && effects[0] === 'READ_ONLY'
}

/** Why a probe was refused, in words a person running an audit can act on. */
export function whyUnsafe(name: string): string {
  const effects = ENDPOINTS[name]
  if (!effects) {
    return `${name} is not classified in endpoint-registry.ts. Classify it before probing it.`
  }
  if (isSafeToProbe(name)) return ''
  return `${name} is ${effects.join(' + ')} — calling it has real-world effects.`
}
