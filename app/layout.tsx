import type { Metadata, Viewport } from 'next'
import { GeistSans } from 'geist/font/sans'
import './globals.css'
import RegisterSW from '@/components/register-sw'

/*
 * Geist is self-hosted via Vercel's package. A CSS @import to Google Fonts is a
 * render-blocking third-party request — on a slow mobile connection that is a
 * visible wait before any text appears, and it fails outright on networks that
 * block Google. This ships the font with the app.
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
  themeColor: '#0A56C4',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={GeistSans.variable}>
      <body>
        {children}
        <RegisterSW />
      </body>
    </html>
  )
}
