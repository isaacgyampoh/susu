import type { Metadata, Viewport } from 'next'
import { GeistMono } from 'geist/font/mono'
import { Bricolage_Grotesque, Public_Sans } from 'next/font/google'
import './globals.css'
import RegisterSW from '@/components/register-sw'
import { Providers } from '@/components/ui'

/*
 * ── TYPE ──────────────────────────────────────────────────────────────────
 *
 * Three faces, each doing a job the others cannot.
 *
 * BRICOLAGE GROTESQUE carries headings. It has an actual voice — slightly
 * condensed, a little irregular — which is what stops the console reading as
 * the same anonymous grotesque every dashboard ships with. It appears only at
 * heading sizes, where character is an asset; set at 14px it would just be
 * harder to read.
 *
 * PUBLIC SANS carries everything else. It was drawn for government services —
 * dense forms, long tables, people who did not choose to be there — which is
 * exactly this application's problem. It is neutral without being Inter.
 *
 * GEIST MONO carries member IDs, payment references and Ghana Card numbers.
 * Those get read aloud down a phone line and typed into other systems, so the
 * digits have to be unambiguous: a proportional 0/O or 1/l is a real
 * transcription error, not a stylistic preference.
 *
 * All three are self-hosted. `next/font/google` downloads them at BUILD time
 * and serves them from this domain, so there is no render-blocking request to
 * fonts.googleapis.com — which matters on a slow Ghanaian mobile connection,
 * and matters more on a network that blocks Google outright. The previous
 * comment here worried about exactly that; using next/font keeps the guarantee.
 */
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
  // Next ships no fallback metrics for Bricolage, so there is no size-adjust to
  // compute. Saying so explicitly keeps the build quiet about a thing that is
  // not broken. Headings are the only user, and they are short enough that the
  // swap is a nudge rather than a reflow.
  adjustFontFallback: false,
})

const sans = Public_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
  fallback: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'system-ui', 'sans-serif'],
})
export const metadata: Metadata = {
  title: { default: 'Abbie Wealth Susu — Administrator console', template: '%s · Abbie Wealth' },
  description: 'Track your contributions, see your slot in the rotation, and know exactly when you collect.',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Abbie Wealth' },
  icons: {
    icon: [{ url: '/icon-192.png', sizes: '192x192' }, { url: '/icon-512.png', sizes: '512x512' }],
    apple: '/apple-touch-icon.png',
  },
  formatDetection: { telephone: false },
  // A private console has no business in a search index
  robots: { index: false, follow: false, nocache: true },
}

export const viewport: Viewport = {
  // Matches the page ground, so the iOS status bar and Android chrome blend
  // into the app instead of framing it with a colour used nowhere else.
  themeColor: '#F7F8FA',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${GeistMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
        <RegisterSW />
      </body>
    </html>
  )
}
