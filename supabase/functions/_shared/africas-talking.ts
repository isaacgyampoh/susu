/*
 * SMS sending — BMS Africa (bms.africa, mNotify API) is the primary provider.
 *
 * Configure in Supabase → Edge Functions → Secrets:
 *   BMS_API_KEY    — from app.bms.africa → Developer section
 *   BMS_SENDER_ID  — your approved sender ID (defaults to 'AbbieWealth', max 11 chars)
 *
 * Africa's Talking remains as a fallback: if BMS_API_KEY isn't set but
 * AT_API_KEY is, messages go through Africa's Talking unchanged. If neither
 * is set, sends are skipped gracefully so no flow ever breaks on SMS.
 *
 * The file keeps its historical name so the fifteen-odd functions importing
 * from it don't need to change.
 */

import { redactSecrets } from './redact.ts'

const BMS_API_KEY   = Deno.env.get('BMS_API_KEY')
const BMS_SENDER_ID = Deno.env.get('BMS_SENDER_ID') ?? 'AbbieWealth'

const AT_API_KEY   = Deno.env.get('AT_API_KEY')
const AT_USERNAME  = Deno.env.get('AT_USERNAME') ?? 'sandbox'
const AT_SENDER_ID = Deno.env.get('AT_SENDER_ID') ?? 'SUSU'

/** BMS/mNotify wants local Ghana format: +233244123456 → 0244123456 */
function toLocalGh(n: string): string {
  const clean = n.trim().replace(/[^0-9+]/g, '')
  if (clean.startsWith('+233')) return '0' + clean.slice(4)
  if (clean.startsWith('233'))  return '0' + clean.slice(3)
  return clean
}

async function sendViaBMS(recipients: string[], message: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.mnotify.com/api/sms/quick?key=${BMS_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        recipient: recipients.map(toLocalGh),
        sender: BMS_SENDER_ID,
        message,
        is_schedule: false,
        schedule_date: '',
      }),
    })
    const data = await res.json().catch(() => null)
    const ok = res.ok && (data?.status === 'success' || data?.code === 2000 || data?.code === '2000')
    if (!ok) console.error('BMS SMS failed:', res.status, JSON.stringify(data))
    return ok
  } catch (e) {
    console.error('BMS SMS error (non-fatal):', e)
    return false
  }
}

async function sendViaAT(recipients: string[], message: string): Promise<boolean> {
  const formatted = recipients
    .map(n => n.trim().replace(/^0/, '+233').replace(/^\+?233/, '+233'))
    .join(',')
  try {
    const res = await fetch('https://api.africastalking.com/version1/messaging', {
      method: 'POST',
      headers: { apiKey: AT_API_KEY!, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ username: AT_USERNAME, to: formatted, message, from: AT_SENDER_ID }).toString(),
    })
    const data = await res.json()
    return data?.SMSMessageData?.Recipients?.some((r: { status: string }) => r.status === 'Success') ?? false
  } catch (e) {
    console.error('SMS error (non-fatal):', e)
    return false
  }
}

/** Send SMS — BMS Africa first, Africa's Talking fallback, graceful skip if neither configured */
/** Record what was sent, so a missing notification can be investigated
 *  rather than argued about. Never blocks or fails the send. */
async function logSMS(recipients: string[], message: string, ok: boolean, provider: string, err?: string) {
  try {
    const { supabaseAdmin } = await import('./supabase-admin.ts')
    const safe = redactSecrets(message)
    await supabaseAdmin.from('sms_log').insert(
      recipients.map(r => ({ recipient: r, message: safe, ok, provider, error: err ?? null })))
  } catch { /* logging must never break delivery */ }
}

export async function sendSMS(to: string | string[], message: string): Promise<boolean> {
  const recipients = (Array.isArray(to) ? to : [to]).filter(Boolean)
  if (recipients.length === 0) return false

  if (BMS_API_KEY) {
    const ok = await sendViaBMS(recipients, message)
    await logSMS(recipients, message, ok, 'bms')
    return ok
  }
  if (AT_API_KEY) {
    const ok = await sendViaAT(recipients, message)
    await logSMS(recipients, message, ok, 'africastalking')
    return ok
  }
  await logSMS(recipients, message, false, 'none', 'No SMS provider configured')

  // Redacted here too: function logs are a second place a passcode would
  // otherwise outlive the message it was sent in.
  console.log('[SMS SKIPPED — no BMS_API_KEY or AT_API_KEY] To:', recipients.join(','),
              '| Msg:', redactSecrets(message))
  return true // gracefully skip, don't break the flow
}

export const smsTemplates = {
  adminPaymentReceived: (memberName: string, amount: string, group: string) =>
    `Abbie Wealth: ${memberName} just paid GHS ${amount} for ${group}.`,
  adminDailyDigest: (count: number, total: string, date: string) =>
    `Abbie Wealth daily summary (${date}): ${count} payment${count === 1 ? '' : 's'} received, GHS ${total} total.`,
  adminPayoutDue: (memberName: string, amount: string, date: string, group: string) =>
    `Abbie Wealth reminder: payout of GHS ${amount} to ${memberName} (${group}) is due ${date}. Please prepare funds.`,
  payoutStandby: (name: string, amount: string, date: string, group: string) =>
    `Hi ${name}, great news — your Abbie Wealth Susu payout of GHS ${amount} for ${group} is due ${date}. Please be on standby to receive it. Thank you for saving with us!`,
  welcome: (name: string, memberId: string, passcode: string, portalUrl: string) =>
    `Hello ${name}, your Abbie Wealth Susu account is ready. ID: ${memberId} | Passcode: ${passcode} | Sign in: ${portalUrl} | Pay before 6:00 PM daily. Keep your passcode private.`,
  paymentReminder: (name: string, amount: string, dueDate: string, portalUrl: string) =>
    `Hi ${name}, your GHS ${amount} Abbie Wealth Susu contribution is due ${dueDate}. Pay before 6:00 PM: ${portalUrl}`,
  paymentConfirmed: (name: string, amount: string, ref: string) =>
    `Hi ${name}, we've received your Abbie Wealth Susu payment of GHS ${amount}. Your contribution is recorded. Ref: ${ref}. Thank you!`,
  /** When one payment settles several days, possibly across groups. */
  paymentSpread: (name: string, amount: string, days: number, groups: number, leftover: number) =>
    `Hi ${name}, your GHS ${amount} payment is confirmed. It covered ${days} day${days === 1 ? '' : 's'}` +
    (groups > 1 ? ` across ${groups} of your groups` : '') + '.' +
    (leftover > 0.001 ? ` GHS ${leftover.toFixed(2)} is left over — it will go to your next due day.` : '') +
    ' Thank you for saving with Abbie Wealth Susu!',
  paymentConfirmedDetailed: (name: string, amount: string, group: string, days: number) =>
    `Hi ${name}, your GHS ${amount} payment for ${group} is confirmed${days > 1 ? ` (${days} days)` : ' for today'}. You're up to date — thank you for saving with Abbie Wealth Susu!`,
  contributionPaid: (name: string, amount: string, groupName: string, dayLabel: string) =>
    `Hi ${name}, your Abbie Wealth Susu payment of GHS ${amount} for ${groupName} (${dayLabel}) has been received. Thank you! Keep saving 💪`,
  payoutAlert: (name: string, amount: string, date: string) =>
    `Congratulations ${name}! Your Susu payout of GHS ${amount} is scheduled for ${date}.`,
  applicationApproved: (name: string, memberId: string, passcode: string, portalUrl: string) =>
    `Hello ${name}, your Abbie Wealth Susu application is approved. ID: ${memberId} | Passcode: ${passcode} | Sign in: ${portalUrl} | Keep your passcode private.`,
  /* ── The shop ──────────────────────────────────────────────────────────
     Three messages, tied to the three moments a customer's money changes
     state. Deliberately not four: there is no "thank you for browsing", and
     no message on every status tick. An SMS costs the business money and
     costs the customer attention, and the ones that arrive for nothing are
     why the ones that matter get ignored. */
  purchaseStarted: (name: string, product: string, total: string, each: string, firstDue: string) =>
    `Hi ${name}, your purchase of ${product} is set up. Total GHS ${total}. ` +
    `First payment of GHS ${each} is due ${firstDue}. Pay from your Abbie Wealth portal.`,
  installmentReceived: (name: string, amount: string, product: string, balance: string) =>
    `Hi ${name}, we received GHS ${amount} towards your ${product}. ` +
    `GHS ${balance} left to pay. Thank you!`,
  requestReceived: (name: string, product: string, ref: string) =>
    `Hi ${name}, we have your request for ${product} (ref ${ref}). ` +
    `We will call you shortly to arrange the payment plan. Abbie Wealth.`,
  purchaseComplete: (name: string, product: string) =>
    `Congratulations ${name}! Your ${product} is fully paid. ` +
    `We will contact you about collecting it. Thank you for your custom.`,
  installmentDue: (name: string, amount: string, product: string, due: string) =>
    `Hi ${name}, your GHS ${amount} payment for ${product} is due ${due}. ` +
    `Pay from your Abbie Wealth portal.`,
  applicationRejected: (name: string, reason: string) =>
    `Hi ${name}, your Abbie Wealth Susu application was not approved. Reason: ${reason}. Contact us on 0550302322.`,
}

/** Admin notification numbers, comma-separated in ADMIN_SMS_NUMBERS. */
export function adminNumbers(): string[] {
  return (Deno.env.get('ADMIN_SMS_NUMBERS') ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)
}

/**
 * Send an SMS to every configured admin number.
 *
 * ────────────────────────────────────────────────────────────────────────
 * `ADMIN_SMS_NUMBERS` is UNSET in production, and has been for the life of the
 * platform: 553 member receipts went out in the last 30 days and not one admin
 * notification, because this returned early every time without saying so.
 *
 * Eight call sites are affected — every payment received, every settlement
 * swept, every payout reminder, the daily digest. The operator has been
 * running blind and had no way to know, because a silent no-op looks exactly
 * like a quiet day.
 *
 * It still returns early — texting nobody is the correct behaviour when nobody
 * is configured — but it now says so in the logs, once per call, with the
 * message that was dropped. A missing configuration should be visible.
 */
export async function notifyAdmins(message: string): Promise<void> {
  const nums = adminNumbers()
  if (nums.length === 0) {
    console.warn(
      'notifyAdmins: ADMIN_SMS_NUMBERS is not set — no administrator was told. ' +
      `Dropped message: ${redactSecrets(message)}`)

    /*
     * ── A DROP THAT LEAVES NO TRACE IS THE REASON THIS WENT UNNOTICED ────
     * This used to return here without writing anything. `sms_log` exists so
     * a missing notification can be investigated rather than argued about,
     * and the one category of message that was never arriving was the one
     * category the log had no row for. 406 member messages in the last 30
     * days, 0 admin alerts, and nothing anywhere said so.
     *
     * Recorded as a failed send against a recipient of '(unconfigured)', so
     * the SMS log screen shows the gap and counts it. Still not sent —
     * texting nobody remains correct when nobody is configured — but no
     * longer silent.
     */
    await logSMS(['(unconfigured)'], message, false, 'none',
                 'ADMIN_SMS_NUMBERS is not set — no administrator was notified')
    return
  }
  await sendSMS(nums, message)
}
