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
      <main className="pb-28">{children}</main>
      <div className="fixed bottom-[86px] inset-x-0 z-40 px-5 pointer-events-none">
        <div className="max-w-[420px] mx-auto pointer-events-auto">
          <InstallApp compact />
        </div>
      </div>
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
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
            </button>
          </div>
        </div>
      </nav>
    </div>
  )
}
