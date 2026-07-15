'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { clearMemberAuth } from '@/lib/supabase'

const TABS = [
  { href: '/member/dashboard', label: 'Card' },
  { href: '/member/payments',  label: 'Payments' },
  { href: '/member/profile',   label: 'Profile' },
]

export default function MemberLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router   = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem('member_token')) { router.replace('/login'); return }
    setReady(true)
  }, [router])
  if (!ready) return null

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-40 bg-paper border-b border-line">
        <div className="max-w-[440px] mx-auto px-5 h-14 flex items-center justify-between">
          <nav className="flex gap-5">
            {TABS.map(({ href, label }) => (
              <Link key={href} href={href}
                className={`text-[13px] py-4 transition-colors border-b-2 -mb-px ${
                  pathname === href ? 'font-bold text-ink border-ink' : 'font-medium text-ink-2 border-transparent hover:text-ink'
                }`}>
                {label}
              </Link>
            ))}
          </nav>
          <button onClick={() => { clearMemberAuth(); router.push('/login') }}
            className="t-label hover:text-ink transition-colors">Exit</button>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  )
}
