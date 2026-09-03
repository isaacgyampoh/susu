'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Home, Wallet, Users, FileText, User, type LucideIcon } from 'lucide-react'
import InstallApp from '@/components/install-app'
import { cx } from '@/components/ui'

const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/m/portal/dashboard', label: 'Home',     icon: Home },
  { href: '/m/portal/payments',  label: 'Payments', icon: Wallet },
  // Groups was reachable only by a link from the home screen, which made
  // "what else could I join" something a member had to already know about.
  { href: '/m/portal/groups',    label: 'Groups',   icon: Users },
  { href: '/m/portal/statement', label: 'Statement',icon: FileText },
  { href: '/m/portal/profile',   label: 'Profile',  icon: User },
]

export default function MemberLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router   = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem('member_token')) { router.replace('/m/login'); return }
    setReady(true)
  }, [router])

  // Rendering nothing until the token check completes stops a signed-out
  // member seeing a flash of someone else's shaped screen.
  if (!ready) return null

  return (
    <div className="min-h-[100dvh] bg-bg">
      {/* Padding equals the tab bar's height plus the home indicator, so the
          last row of a list is never trapped underneath it. */}
      <main className="pb-[calc(var(--tabbar)+env(safe-area-inset-bottom))]">
        {children}
      </main>

      <div className="fixed inset-x-0 bottom-[calc(var(--tabbar)+env(safe-area-inset-bottom))] z-40 px-4 pointer-events-none">
        <div className="portal-w pointer-events-auto">
          <InstallApp compact />
        </div>
      </div>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 bg-surface/85 backdrop-blur-xl border-t border-line
                   pb-[env(safe-area-inset-bottom)]"
      >
        {/* Spans the viewport. A tab bar centred in a 448px box reads as a
            navigation strip inside a web page; the application's navigation
            should reach both edges of the device. It constrains only at the
            width where the content column itself does. */}
        <div className="w-full md:max-w-[46rem] md:mx-auto
                        flex items-stretch h-[var(--tabbar)] px-1.5 md:px-2">
          {TABS.map(({ href, label, icon: Icon }) => {
            const on = pathname === href
            return (
              <Link
                key={href} href={href}
                aria-current={on ? 'page' : undefined}
                className={cx(
                  'flex-1 flex flex-col items-center justify-center gap-1 rounded-md my-2 transition-colors',
                  on ? 'text-ink' : 'text-ink-3 hover:text-ink-2 active:bg-surface-2',
                )}
              >
                {/* Filled pill behind the active glyph — legible at a glance
                    from arm's length, which a 1px colour shift is not. */}
                <span className={cx(
                  'grid place-items-center w-12 h-7 rounded-full transition-colors',
                  on && 'bg-ink text-inverse',
                )}>
                  <Icon size={18} strokeWidth={on ? 2.3 : 2} aria-hidden="true" />
                </span>
                <span className={cx('text-2xs', on ? 'font-semibold' : 'font-medium')}>{label}</span>
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
