/**
 * WHERE LINKS POINT.
 *
 * ────────────────────────────────────────────────────────────────────────
 * One deployment serves three audiences on three hostnames, and middleware
 * enforces the split:
 *
 *   abbiewealthsusu.com        the public site — the application form, and
 *                              the registration payment page
 *   my.abbiewealthsusu.com     the member portal (/admin/* is 404 here)
 *   admin.abbiewealthsusu.com  the console (/m/* is 404 here)
 *
 * `FRONTEND_URL` is set to the CONSOLE in this deployment. That is not a
 * guess: kyc-review carries a comment recording that building a member link
 * from it produced `admin.abbiewealthsusu.com/m/login` — a 404 in the
 * member's hand. A link is configuration, not inference, and reaching for
 * whichever URL variable happens to exist is how that bug happened.
 *
 * So each audience gets its own accessor with its own correct default, and
 * FRONTEND_URL is deliberately not consulted by either.
 */

const trim = (u: string) => u.replace(/\/+$/, '')

/** The public site: the application form and the registration payment page. */
export const publicSiteUrl = () =>
  trim(Deno.env.get('PUBLIC_SITE_URL') ?? Deno.env.get('WEB_URL') ?? 'https://abbiewealthsusu.com')

/** The member portal. Never the console — /m/* is 404 there. */
export const memberPortalUrl = () =>
  trim(Deno.env.get('MEMBER_URL') ?? 'https://my.abbiewealthsusu.com')

/** An applicant's registration payment link. */
export const registrationPaymentUrl = (token: string) =>
  `${publicSiteUrl()}/join/pay/${token}`
