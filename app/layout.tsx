import type { Metadata, Viewport } from 'next'
import './globals.css'
import RegisterSW from '@/components/register-sw'

export const metadata: Metadata = {
  title: { default: 'Susu — Save daily, collect on your day', template: '%s · Susu' },
  description: 'Track your contributions, see your slot in the rotation, and know exactly when you collect.',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Susu' },
  icons: {
    icon: [{ url: '/icon-192.png', sizes: '192x192' }, { url: '/icon-512.png', sizes: '512x512' }],
    apple: '/apple-touch-icon.png',
  },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  themeColor: '#0A56C4',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <RegisterSW />
      </body>
    </html>
  )
}
