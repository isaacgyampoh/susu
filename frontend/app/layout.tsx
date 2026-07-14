import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title:       'Susu Platform — Community Savings Made Simple',
  description: 'Join a trusted rotating savings group. Contribute daily, receive your payout on schedule.',
  keywords:    'susu, savings, Ghana, rotating savings, community finance',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
