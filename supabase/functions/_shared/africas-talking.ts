const AT_API_KEY   = Deno.env.get('AT_API_KEY')
const AT_USERNAME  = Deno.env.get('AT_USERNAME') ?? 'sandbox'
const AT_SENDER_ID = Deno.env.get('AT_SENDER_ID') ?? 'SUSU'

/** Send SMS — silently skips if AT_API_KEY not configured */
export async function sendSMS(to: string | string[], message: string): Promise<boolean> {
  if (!AT_API_KEY) {
    console.log('[SMS SKIPPED — no AT_API_KEY] To:', to, '| Msg:', message)
    return true // gracefully skip, don't break the flow
  }

  const recipients = Array.isArray(to) ? to : [to]
  const formatted  = recipients
    .map(n => n.trim().replace(/^0/, '+233').replace(/^\+?233/, '+233'))
    .join(',')

  try {
    const res = await fetch('https://api.africastalking.com/version1/messaging', {
      method: 'POST',
      headers: { apiKey: AT_API_KEY, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ username: AT_USERNAME, to: formatted, message, from: AT_SENDER_ID }).toString(),
    })
    const data = await res.json()
    return data?.SMSMessageData?.Recipients?.some((r: { status: string }) => r.status === 'Success') ?? false
  } catch (e) {
    console.error('SMS error (non-fatal):', e)
    return false
  }
}

export const smsTemplates = {
  welcome: (name: string, memberId: string, passcode: string, portalUrl: string) =>
    `Hello ${name}, your Abbie Wealth Susu account is ready. ID: ${memberId} | Passcode: ${passcode} | Sign in: ${portalUrl} | Pay before 6:00 PM daily. Keep your passcode private.`,
  paymentReminder: (name: string, amount: string, dueDate: string, portalUrl: string) =>
    `Hi ${name}, your GHS ${amount} Abbie Wealth Susu contribution is due ${dueDate}. Pay before 6:00 PM: ${portalUrl}`,
  paymentConfirmed: (name: string, amount: string, ref: string) =>
    `Hi ${name}, your GHS ${amount} payment is confirmed. Ref: ${ref}. Thank you!`,
  payoutAlert: (name: string, amount: string, date: string) =>
    `Congratulations ${name}! Your Susu payout of GHS ${amount} is scheduled for ${date}.`,
  applicationApproved: (name: string, memberId: string, passcode: string, portalUrl: string) =>
    `Hello ${name}, your Abbie Wealth Susu application is approved. ID: ${memberId} | Passcode: ${passcode} | Sign in: ${portalUrl} | Keep your passcode private.`,
  applicationRejected: (name: string, reason: string) =>
    `Hi ${name}, your Abbie Wealth Susu application was not approved. Reason: ${reason}. Contact us on 0550302322.`,
}
