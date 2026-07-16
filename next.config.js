/** @type {import('next').NextConfig} */

const SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://qaelfwtbaehdwhnxkpid.supabase.co'

/*
 * The session token lives in localStorage, which means any script that runs on
 * this origin can read it. A strict CSP is what keeps that from being a way in:
 * no third-party scripts, no inline injection, nothing to talk to but Supabase.
 * Headers are cheap and this app has no reason to load anything external.
 */
const csp = [
  "default-src 'self'",
  // Next needs inline/eval for hydration and dev; no third-party origins.
  `script-src 'self' 'unsafe-inline' ${process.env.NODE_ENV === 'development' ? "'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.supabase.co",
  "font-src 'self' data:",
  `connect-src 'self' ${SUPABASE} https://*.supabase.co`,
  "form-action 'self'",
  "frame-ancestors 'none'",     // clickjacking: nothing may frame the console
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].filter(Boolean).join('; ')

const headers = [
  { key: 'Content-Security-Policy',   value: csp },
  { key: 'X-Frame-Options',           value: 'DENY' },
  { key: 'X-Content-Type-Options',    value: 'nosniff' },
  { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-DNS-Prefetch-Control',    value: 'off' },
]

module.exports = {
  poweredByHeader: false,   // don't advertise the stack
  images: { remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co' }] },
  async headers() {
    return [
      { source: '/:path*', headers },
      // A member's card or an admin table must never be cached by a proxy
      { source: '/admin/:path*', headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }] },
      { source: '/m/portal/:path*', headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }] },
    ]
  },
}
