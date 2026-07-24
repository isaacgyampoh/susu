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
    await supabaseAdmin.from('sms_log').insert(
      recipients.map(r => ({ recipient: r, message, ok, provider, error: err ?? null })))
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

  console.log('[SMS SKIPPED — no BMS_API_KEY or AT_API_KEY] To:', recipients.join(','), '| Msg:', message)
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
  applicationRejected: (name: string, reason: string) =>
    `Hi ${name}, your Abbie Wealth Susu application was not approved. Reason: ${reason}. Contact us on 0550302322.`,
}

/** Admin notification numbers, comma-separated in ADMIN_SMS_NUMBERS. */
export function adminNumbers(): string[] {
  return (Deno.env.get('ADMIN_SMS_NUMBERS') ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)
}

/** Send an SMS to every configured admin number (no-op if none set). */
export async function notifyAdmins(message: string): Promise<void> {
  const nums = adminNumbers()
  if (nums.length === 0) return
  await sendSMS(nums, message)
}
