import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'SusuPlatform — Member Portal',
  description: 'Susu savings platform — manage your contributions, track payouts, and grow together.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
