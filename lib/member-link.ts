/**
 * The member portal lives on its own hostname (my.abbiewealthsusu.com).
 *
 * It must never be derived from window.location.origin: the console runs on
 * admin.abbiewealthsusu.com, and middleware 404s /m/* there — so an origin-built
 * link is a dead link in the member's hand. It is configuration, not inference.
 */
export const MEMBER_PORTAL =
  process.env.NEXT_PUBLIC_MEMBER_URL ?? 'https://my.abbiewealthsusu.com'

export const memberSignInUrl = () => `${MEMBER_PORTAL}/m/login`

/** The message an admin sends a new member. One wording, used by both paths. */
export function credentialsMessage(m: {
  full_name?: string
  member_id: string
  phone: string
  passcode: string
  group?: string | null
}) {
  const hi = m.full_name ? `Hello ${m.full_name.split(' ')[0]},\n\n` : ''
  return (
    `${hi}Your Abbie Wealth Susu account is ready.\n\n` +
    `Sign in: ${memberSignInUrl()}\n` +
    `Phone: ${m.phone}\n` +
    `Passcode: ${m.passcode}\n` +
    `Member ID: ${m.member_id}\n` +
    (m.group ? `Group: ${m.group}\n` : '') +
    `\nPay before 6:00 PM every day. Keep your passcode private — it is yours alone.\n\n` +
    `Tip: open the link in Chrome or Safari (not inside WhatsApp) and you can ` +
    `install it to your home screen like an app.`
  )
}

/** wa.me needs an international number with no plus and no spaces. */
export function whatsappLink(phone: string, text: string) {
  const to = phone.replace(/\D/g, '').replace(/^0/, '233')
  return `https://wa.me/${to}?text=${encodeURIComponent(text)}`
}
