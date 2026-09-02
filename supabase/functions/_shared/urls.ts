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
 *
 * ────────────────────────────────────────────────────────────────────────
 * AND THEN I MADE THE SAME MISTAKE.
 *
 * `publicSiteUrl()` originally defaulted to `https://abbiewealthsusu.com`,
 * which reads like the obvious home for a public page. It is a SEPARATE Vercel
 * project — a marketing site — and it does not serve this application at all:
 *
 *     GET https://abbiewealthsusu.com/join           404
 *     GET https://abbiewealthsusu.com/join/pay/<t>   404
 *     GET https://my.abbiewealthsusu.com/join/pay/<t>  200
 *
 * Every registration payment link would have pointed at a page that does not
 * exist — sent by SMS, to applicants, as the only copy of a token that cannot
 * be recovered. Caught by requesting the route in production rather than
 * trusting the name.
 *
 * The default is therefore the host that actually serves these routes.
 * `PUBLIC_SITE_URL` still overrides it, for the day the apex does serve them.
 */

const trim = (u: string) => u.replace(/\/+$/, '')

/**
 * Where the application form and the registration payment page live.
 *
 * Defaults to the member host because that is what serves `/join` and
 * `/join/pay/<token>` in this deployment — verified by request, not assumed
 * from the domain name.
 */
export const publicSiteUrl = () =>
  trim(Deno.env.get('PUBLIC_SITE_URL') ?? Deno.env.get('WEB_URL')
       ?? Deno.env.get('MEMBER_URL') ?? 'https://my.abbiewealthsusu.com')

/** The member portal. Never the console — /m/* is 404 there. */
export const memberPortalUrl = () =>
  trim(Deno.env.get('MEMBER_URL') ?? 'https://my.abbiewealthsusu.com')

/** An applicant's registration payment link. */
export const registrationPaymentUrl = (token: string) =>
  `${publicSiteUrl()}/join/pay/${token}`
