'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { clearAdminAuth } from '@/lib/supabase'
import { useSwipeDrawer } from '@/components/swipe-drawer'

type NavItem = { href: string; label: string; exact?: boolean; hint?: string }
const NAV: { group: string; items: NavItem[] }[] = [
  { group: 'Overview', items: [
    { href: '/admin',               label: 'Dashboard', exact: true },
  ]},
  // Grouped by what the operator is doing, not by which table it touches.
  { group: 'Every day', items: [
    { href: '/admin/transactions',  label: 'Daily Payments', hint: 'who paid today' },
    { href: '/admin/kyc',           label: 'Applications',   hint: 'new sign-ups' },
    { href: '/admin/payouts',       label: 'Payouts',        hint: 'who collects' },
  ]},
  { group: 'People & groups', items: [
    { href: '/admin/members',       label: 'Members' },
    { href: '/admin/groups',        label: 'Groups' },
  ]},
  { group: 'Money detail', items: [
    { href: '/admin/contributions', label: 'Contributions', hint: 'day-by-day dues' },
    { href: '/admin/analytics',     label: 'Analytics' },
    { href: '/admin/reports',       label: 'Reports' },
  ]},
  { group: 'Messages', items: [
    { href: '/admin/announcements', label: 'Announcements', hint: 'text everyone' },
    { href: '/admin/sms-log',       label: 'SMS Log',       hint: 'what was sent' },
    { href: '/admin/messages',      label: 'Enquiries',     hint: 'from the website' },
  ]},
  { group: 'Settings', items: [
    { href: '/admin/payment-settings', label: 'Payments' },
    { href: '/admin/audit',            label: 'Audit log' },
    { href: '/admin/password',         label: 'Change password' },
  ]},
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router   = useRouter()
  const DRAWER = 264
  const { open, setOpen, close, shown, dragging } = useSwipeDrawer(DRAWER)
  const [admin, setAdmin] = useState<{ full_name: string; role: string; must_change_password?: boolean } | null>(null)

  useEffect(() => {
    if (!localStorage.getItem('admin_token')) { router.replace('/'); return }
    try { setAdmin(JSON.parse(localStorage.getItem('admin_user') ?? '{}')) } catch {}
  }, [router])

  // Close on navigation — otherwise the drawer hangs over the new page
  useEffect(() => { close() }, [pathname, close])

  const on = (h: string, exact?: boolean) => exact ? pathname === h : pathname.startsWith(h)

  const nav = (
    <>
      <nav className="flex-1 overflow-y-auto py-5 px-3 space-y-6">
        {NAV.map(({ group, items }) => (
          <div key={group}>
            <p className="px-2.5 mb-1.5 text-[11px] font-medium text-ink-3">{group}</p>
            <div className="space-y-0.5">
              {items.map(({ href, label, exact, hint }) => (
                <Link key={href} href={href}
                  className={`block px-2.5 py-2 rounded-lg text-[13px] transition-colors ${
                    on(href, exact) ? 'bg-ink text-white font-medium' : 'text-ink-2 hover:text-ink hover:bg-bg'
                  }`}>
                  {label}
                  {hint && (
                    <span className={`block text-[10.5px] font-normal mt-0.5 ${on(href, exact) ? 'text-white/55' : 'text-ink-3'}`}>
                      {hint}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="border-t border-line p-3 shrink-0">
        {admin && (
          <div className="px-2.5 pb-2.5">
            <p className="text-[12.5px] font-medium truncate">{admin.full_name}</p>
            <p className="text-[11px] text-ink-3 capitalize">{admin.role?.replace('_', ' ')}</p>
          </div>
        )}
        <button onClick={() => { clearAdminAuth(); router.push('/') }}
          className="w-full text-left px-2.5 py-2 rounded-lg text-[12.5px] text-ink-2 hover:text-ink hover:bg-bg transition-colors">
          Sign out
        </button>
      </div>
    </>
  )

  return (
    <div className="min-h-screen">
      {/* Desktop rail */}
      <aside className="hidden lg:flex flex-col fixed inset-y-0 left-0 w-[210px] bg-surface border-r border-line z-30">
        <div className="px-5 h-14 flex items-center border-b border-line shrink-0">
          <Link href="/admin" className="text-[14px] font-semibold tracking-[-.02em]">Abbie Wealth</Link>
        </div>
        {nav}
      </aside>

      {/* Mobile bar. Swipe from the left edge opens the drawer, but a gesture
          alone is not discoverable and does not exist on every device — so
          there is always a control. Three bars, drawn in CSS: a standard
          affordance rather than a decorative icon. */}
      <div className="lg:hidden sticky top-0 z-30 h-14 bg-surface border-b border-line flex items-center gap-3 px-4">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          aria-expanded={open}
          className="-ml-1 w-10 h-10 rounded-lg grid place-items-center active:bg-bg transition-colors"
        >
          <span className="flex flex-col gap-[4.5px] w-[18px]">
            <span className="h-[1.5px] w-full bg-ink rounded-full" />
            <span className="h-[1.5px] w-full bg-ink rounded-full" />
            <span className="h-[1.5px] w-full bg-ink rounded-full" />
          </span>
        </button>
        <Link href="/admin" className="text-[14px] font-semibold tracking-[-.02em]">Abbie Wealth</Link>
      </div>

      {/* Scrim fades in proportion to the drag, so the gesture feels attached */}
      {shown > 0 && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-ink"
          style={{ opacity: (shown / DRAWER) * 0.3, transition: dragging ? 'none' : 'opacity .22s ease-out' }}
          onClick={close}
        />
      )}

      <aside
        className="lg:hidden fixed inset-y-0 left-0 z-50 w-[264px] max-w-[82vw] bg-surface border-r border-line flex flex-col"
        style={{
          transform: `translateX(${shown - DRAWER}px)`,
          transition: dragging ? 'none' : 'transform .26s cubic-bezier(.32,.72,0,1)',
          visibility: shown > 0 ? 'visible' : 'hidden',
        }}
      >
        <div className="px-5 h-14 flex items-center border-b border-line shrink-0">
          <span className="text-[14px] font-semibold tracking-[-.02em]">Abbie Wealth</span>
        </div>
        {nav}
      </aside>

      {/* Content: offset by the rail on desktop, full width on mobile.
          min-w-0 so wide tables scroll instead of blowing out the layout. */}
      {/* min-w-0 lets children shrink; children scroll their own wide content.
          overflow-x-hidden here would CLIP tables rather than let them scroll. */}
      <main className="lg:pl-[210px] min-w-0">
        {/* The shipped password is public — it is in the repo. Say so, loudly,
            on every screen until it is changed. */}
        {admin?.must_change_password && pathname !== '/admin/password' && (
          <div className="bg-red text-white px-5 sm:px-8 py-2.5 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12.5px]">
              This account still uses the default password, which is published in the source code.
            </p>
            <Link href="/admin/password" className="text-[12.5px] font-semibold underline underline-offset-2">
              Change it now
            </Link>
          </div>
        )}
        <div className="min-w-0">{children}</div>
      </main>
    </div>
  )
}
