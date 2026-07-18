'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { clearMemberAuth } from '@/lib/supabase'
import InstallApp from '@/components/install-app'
const TABS = [
  { href: '/m/portal/dashboard', label: 'Home' },
  { href: '/m/portal/payments',  label: 'Payments' },
  { href: '/m/portal/groups',    label: 'Groups' },
  { href: '/m/portal/profile',   label: 'Profile' },
]

export default function MemberLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router   = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem('member_token')) { router.replace('/m/login'); return }
    setReady(true)
  }, [router])
  if (!ready) return null

  return (
    <div className="min-h-screen">
      <main className="pb-24">{children}</main>
      <nav className="fixed bottom-0 inset-x-0 z-40 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-[420px] mx-auto px-5 pb-4">
          <div className="flex items-center gap-1 p-1.5 bg-paper/95 backdrop-blur-lg rounded-[16px] border border-line"
               style={{ boxShadow: '0 8px 28px -10px rgba(20,38,28,.18)' }}>
            {TABS.map(({ href, label}) => {
              const on = pathname === href
              return (
                <Link key={href} href={href}
                  className={`flex-1 flex items-center justify-center gap-2 h-11 rounded-[11px] text-[13px] font-semibold transition-all ${
                    on ? 'bg-ink text-white' : 'text-ink-2 hover:bg-bg'
                  }`}>
                  {label}
                </Link>
              )
            })}
            <button onClick={() => { clearMemberAuth(); router.push('/m/login') }} aria-label="Sign out"
              className="w-11 h-11 grid place-items-center rounded-[11px] text-ink-3 hover:text-red hover:bg-red-50 transition-colors">
              </button>
          </div>
        </div>
      </nav>
    </div>
  )
}
