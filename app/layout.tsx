import type { Metadata, Viewport } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import './globals.css'
import RegisterSW from '@/components/register-sw'
import { Providers } from '@/components/ui'

/*
 * Geist is self-hosted via Vercel's package. A CSS @import to Google Fonts is a
 * render-blocking third-party request — on a slow mobile connection that is a
 * visible wait before any text appears, and it fails outright on networks that
 * block Google. This ships the font with the app.
 *
 * Mono carries member IDs, payment references and Ghana Card numbers. Those get
 * read aloud down a phone line and typed into other systems, so the digits have
 * to be unambiguous — a proportional 0/O or 1/l is a real transcription error.
 */
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
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
        <RegisterSW />
      </body>
    </html>
  )
}
