'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { clearMemberAuth } from '@/lib/supabase'
import { Home, Wallet, User, LogOut } from 'lucide-react'

const TABS = [
  { href: '/member/dashboard', label: 'Home',     icon: Home   },
  { href: '/member/payments',  label: 'Payments', icon: Wallet },
  { href: '/member/profile',   label: 'Profile',  icon: User   },
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
    <div className="min-h-screen">
      <main>{children}</main>

      {/* Bottom tab bar — thumb-reachable, the right call for a phone-first product */}
      <nav className="fixed bottom-0 inset-x-0 z-40 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto max-w-lg px-5 pb-4">
          <div className="flex items-center gap-1 p-1.5 bg-white/90 backdrop-blur-xl rounded-full border border-hairline"
               style={{ boxShadow: '0 8px 32px -8px rgba(10,31,20,.16)' }}>
            {TABS.map(({ href, label, icon: Icon }) => {
              const on = pathname === href
              return (
                <Link key={href} href={href}
                  className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-full text-[13px] font-semibold transition-all ${
                    on ? 'bg-ink text-white' : 'text-muted hover:text-ink'
                  }`}>
                  <Icon size={16} />
                  <span className={on ? '' : 'hidden sm:inline'}>{label}</span>
                </Link>
              )
            })}
            <button
              onClick={() => { clearMemberAuth(); router.push('/login') }}
              aria-label="Sign out"
              className="w-11 h-11 grid place-items-center rounded-full text-muted hover:text-ink transition-colors">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </nav>
    </div>
  )
}
