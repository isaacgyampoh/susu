'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { clearAdminAuth } from '@/lib/supabase'

const NAV = [
  { group: 'Overview', items: [
    { href: '/admin',               label: 'Dashboard', exact: true },
    { href: '/admin/analytics',     label: 'Analytics' },
  ]},
  { group: 'People', items: [
    { href: '/admin/members',       label: 'Members' },
    { href: '/admin/groups',        label: 'Groups' },
    { href: '/admin/kyc',           label: 'Applications' },
  ]},
  { group: 'Money', items: [
    { href: '/admin/contributions', label: 'Contributions' },
    { href: '/admin/payouts',       label: 'Payouts' },
  ]},
  { group: 'Records', items: [
    { href: '/admin/messages',      label: 'Messages' },
    { href: '/admin/announcements', label: 'Announcements' },
    { href: '/admin/reports',       label: 'Reports' },
    { href: '/admin/audit',         label: 'Audit log' },
  ]},
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router   = useRouter()
  const [open, setOpen]   = useState(false)
  const [admin, setAdmin] = useState<{ full_name: string; role: string } | null>(null)

  useEffect(() => {
    if (!localStorage.getItem('admin_token')) { router.replace('/'); return }
    try { setAdmin(JSON.parse(localStorage.getItem('admin_user') ?? '{}')) } catch {}
  }, [router])

  // Close the drawer on navigation — otherwise it stays open over the new page
  useEffect(() => { setOpen(false) }, [pathname])

  // Don't let the page scroll behind an open drawer
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  const on = (h: string, exact?: boolean) => exact ? pathname === h : pathname.startsWith(h)

  const nav = (
    <>
      <nav className="flex-1 overflow-y-auto py-5 px-3 space-y-6">
        {NAV.map(({ group, items }) => (
          <div key={group}>
            <p className="px-2.5 mb-1.5 text-[11px] font-medium text-ink-3">{group}</p>
            <div className="space-y-0.5">
              {items.map(({ href, label, exact }) => (
                <Link key={href} href={href}
                  className={`block px-2.5 py-2 rounded-lg text-[13px] transition-colors ${
                    on(href, exact) ? 'bg-ink text-white font-medium' : 'text-ink-2 hover:text-ink hover:bg-bg'
                  }`}>
                  {label}
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
          <Link href="/admin" className="text-[14px] font-semibold tracking-[-.02em]">Susu</Link>
        </div>
        {nav}
      </aside>

      {/* Mobile bar */}
      <div className="lg:hidden sticky top-0 z-40 h-14 bg-surface border-b border-line flex items-center justify-between px-5">
        <Link href="/admin" className="text-[14px] font-semibold tracking-[-.02em]">Susu</Link>
        <button onClick={() => setOpen(true)} aria-label="Open menu"
          className="text-[12.5px] font-medium text-ink-2 hover:text-ink">Menu</button>
      </div>

      {/* Mobile drawer — slides from the LEFT, which is where a sidebar lives */}
      {open && (
        <>
          <div className="lg:hidden fixed inset-0 z-40 bg-ink/25" onClick={() => setOpen(false)} />
          <aside className="lg:hidden fixed inset-y-0 left-0 z-50 w-[264px] max-w-[82vw] bg-surface border-r border-line flex flex-col animate-fade-in">
            <div className="px-5 h-14 flex items-center justify-between border-b border-line shrink-0">
              <span className="text-[14px] font-semibold tracking-[-.02em]">Susu</span>
              <button onClick={() => setOpen(false)} aria-label="Close menu"
                className="text-[12.5px] font-medium text-ink-2">Close</button>
            </div>
            {nav}
          </aside>
        </>
      )}

      {/* Content: offset by the rail on desktop, full width on mobile.
          min-w-0 so wide tables scroll instead of blowing out the layout. */}
      <main className="lg:pl-[210px] min-w-0">
        <div className="min-w-0 overflow-x-hidden">{children}</div>
      </main>
    </div>
  )
}
