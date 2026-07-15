'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { clearMemberAuth } from '@/lib/supabase'
import { LogOut } from 'lucide-react'

const TABS = [
  { href: '/member/dashboard', label: 'Card' },
  { href: '/member/payments',  label: 'Pay' },
  { href: '/member/profile',   label: 'You' },
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
      <nav className="fixed bottom-0 inset-x-0 z-40 pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto max-w-[430px] px-[18px] pb-4">
          <div className="flex items-center gap-1 p-1 bg-field-2/95 backdrop-blur-xl rounded-[4px] border border-white/10">
            {TABS.map(({ href, label }) => {
              const on = pathname === href
              return (
                <Link key={href} href={href}
                  className={`flex-1 py-3 text-center rounded-[2px] stencil transition-colors ${on ? 'bg-gold text-ink' : 'text-dim-field hover:text-card'}`}>
                  {label}
                </Link>
              )
            })}
            <button onClick={() => { clearMemberAuth(); router.push('/login') }} aria-label="Sign out"
              className="w-11 h-10 grid place-items-center rounded-[2px] text-dim-field hover:text-card transition-colors">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </nav>
    </div>
  )
}
