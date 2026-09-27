'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Home, Wallet, User, type LucideIcon, ShoppingBag } from 'lucide-react'
import InstallApp from '@/components/install-app'
import { cx } from '@/components/ui'

/*
 * FOUR DESTINATIONS.
 *
 * Five tabs gave 69px targets at 360px — usable, but crowded, and two of them
 * answered questions a member asks rarely. Rotation earns a tab because "when
 * do I collect, and who is next" is the question this product exists to answer
 * and it had no home at all. Statement moves under Profile, where somebody
 * looking for a record of their account will look for it.
 *
 * Four gives 87px targets on the smallest phone this has to work on.
 */
/*
 * ── WHY PURCHASES TOOK ROTATION'S TAB ───────────────────────────────────────
 * The business now sells goods on instalment as well as running rotations, and
 * a growing share of the people here have never joined a group at all — they
 * are paying off a fridge. For them a Rotation tab leads to an empty screen,
 * every time.
 *
 * A fifth tab was the obvious answer and the wrong one: it takes targets from
 * 87px back to 69px at 360px, which is the measurement that put this bar at
 * four in the first place.
 *
 * So Rotation moves one tap away, onto Home — where the member's own payout
 * block already sits and already links to it. A susu member loses nothing they
 * were not already reaching from there; a shop customer stops being offered a
 * screen that has nothing on it.
 */
const TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/m/portal/dashboard', label: 'Home',      icon: Home },
  { href: '/m/portal/purchases', label: 'Purchases', icon: ShoppingBag },
  { href: '/m/portal/payments',  label: 'Payments',  icon: Wallet },
  { href: '/m/portal/profile',   label: 'Profile',   icon: User },
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
        className="fixed inset-x-0 bottom-0 z-40 bg-surface/90 backdrop-blur-xl border-t border-line
                   pb-[env(safe-area-inset-bottom)]"
      >
        {/* Spans the viewport. A tab bar centred in a 448px box reads as a
            navigation strip inside a web page; the application's navigation
            should reach both edges of the device. It constrains only at the
            width where the content column itself does.

            Deliberately still edge-to-edge and opaque rather than the floating
            pill the reference uses: a detached pill sits ON the content, and
            this list scrolls to a last row that people tap. Anchoring it keeps
            `main`'s bottom padding honest — that padding is the only reason
            nothing hides behind it at 320px. */}
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
