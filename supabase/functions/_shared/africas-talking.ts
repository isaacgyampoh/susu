const AT_API_KEY   = Deno.env.get('AT_API_KEY')!
const AT_USERNAME  = Deno.env.get('AT_USERNAME') ?? 'sandbox'
const AT_SENDER_ID = Deno.env.get('AT_SENDER_ID') ?? 'SUSU'
const SMS_BASE     = 'https://api.africastalking.com/version1/messaging'

/** Send an SMS via Africa's Talking */
export async function sendSMS(to: string | string[], message: string): Promise<boolean> {
  const recipients = Array.isArray(to) ? to.join(',') : to

  // Ensure Ghana numbers start with +233
  const formatted = recipients
    .split(',')
    .map((n) => n.trim().replace(/^0/, '+233').replace(/^\+?233/, '+233'))
    .join(',')

  const body = new URLSearchParams({
    username: AT_USERNAME,
    to: formatted,
    message,
    from: AT_SENDER_ID,
  })

  try {
    const res = await fetch(SMS_BASE, {
      method: 'POST',
      headers: {
        apiKey: AT_API_KEY,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    })
    const data = await res.json()
    return data?.SMSMessageData?.Recipients?.some(
      (r: { status: string }) => r.status === 'Success'
    ) ?? false
  } catch (e) {
    console.error('SMS send error:', e)
    return false
  }
}

/** Build common SMS templates */
export const smsTemplates = {
  welcome: (name: string, memberId: string, passcode: string, portalUrl: string) =>
    `Hello ${name}! Welcome to Susu Platform.\nMember ID: ${memberId}\nPasscode: ${passcode}\nPortal: ${portalUrl}\nKeep your passcode safe.`,

  paymentReminder: (name: string, amount: string, dueDate: string, portalUrl: string) =>
    `Hi ${name}, your Susu contribution of GHS ${amount} is due on ${dueDate}.\nPay now: ${portalUrl}\nDo not default to avoid losing your slot.`,

  paymentConfirmed: (name: string, amount: string, ref: string) =>
    `Hi ${name}, your payment of GHS ${amount} has been confirmed.\nRef: ${ref}. Thank you!`,

  payoutAlert: (name: string, amount: string, date: string) =>
    `Congratulations ${name}! You will receive your Susu payout of GHS ${amount} on ${date}. Stay active!`,

  applicationApproved: (name: string, memberId: string, passcode: string, portalUrl: string) =>
    `Great news ${name}! Your Susu application has been approved.\nMember ID: ${memberId}\nPasscode: ${passcode}\nLogin: ${portalUrl}`,

  applicationRejected: (name: string, reason: string) =>
    `Hi ${name}, unfortunately your Susu application was not approved.\nReason: ${reason}\nContact us for more info.`,
}
