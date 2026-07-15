'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { clearAdminAuth } from '@/lib/supabase'
import { Menu, X } from 'lucide-react'

const NAV = [
  { href: '/admin',               label: 'Dashboard', exact: true },
  { href: '/admin/analytics',     label: 'Analytics' },
  { href: '/admin/members',       label: 'Members' },
  { href: '/admin/groups',        label: 'Groups' },
  { href: '/admin/contributions', label: 'Contributions' },
  { href: '/admin/payouts',       label: 'Payouts' },
  { href: '/admin/messages',      label: 'Messages' },
  { href: '/admin/announcements', label: 'Announcements' },
  { href: '/admin/reports',       label: 'Reports' },
  { href: '/admin/audit',         label: 'Audit log' },
  { href: '/admin/kyc',           label: 'KYC review' },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router   = useRouter()
  const [open, setOpen]   = useState(false)
  const [admin, setAdmin] = useState<{ full_name: string; role: string } | null>(null)
  const isLogin = pathname === '/admin/login'

  useEffect(() => {
    if (isLogin) return
    if (!localStorage.getItem('admin_token')) { router.replace('/admin/login'); return }
    try { setAdmin(JSON.parse(localStorage.getItem('admin_user') ?? '{}')) } catch {}
  }, [router, isLogin])

  if (isLogin) return <>{children}</>

  const active = (h: string, exact?: boolean) => exact ? pathname === h : pathname.startsWith(h)

  const nav = (
    <>
      <div className="px-6 pt-7 pb-6">
        <Link href="/admin" className="t-label !text-ink block">Susu — Console</Link>
        {admin && (
          <p className="text-[13px] font-semibold mt-4 truncate">{admin.full_name}</p>
        )}
      </div>

      <nav className="flex-1 px-3 overflow-y-auto">
        {NAV.map(({ href, label, exact }) => (
          <Link key={href} href={href} onClick={() => setOpen(false)}
            className={`block px-3 py-2 text-[13.5px] transition-colors ${
              active(href, exact) ? 'font-bold text-ink' : 'font-medium text-ink-2 hover:text-ink'
            }`}>
            {active(href, exact) && <span className="inline-block w-2.5 h-px bg-ink align-middle mr-2" />}
            {label}
          </Link>
        ))}
      </nav>

      <div className="px-6 py-5 rule">
        <button onClick={() => { clearAdminAuth(); router.push('/admin/login') }}
          className="text-[12px] font-semibold text-ink-2 hover:text-ink transition-colors">
          Sign out
        </button>
      </div>
    </>
  )

  return (
    <div className="min-h-screen flex bg-paper">
      <aside className="hidden md:flex flex-col w-[228px] border-r border-line fixed inset-y-0">
        {nav}
      </aside>

      <div className="md:hidden fixed top-0 inset-x-0 z-50 h-14 bg-paper border-b border-line flex items-center justify-between px-5">
        <span className="t-label !text-ink">Susu — Console</span>
        <button onClick={() => setOpen(!open)} aria-label={open ? 'Close menu' : 'Open menu'} className="text-ink">
          {open ? <X size={19} /> : <Menu size={19} />}
        </button>
      </div>
      {open && (
        <div className="md:hidden fixed inset-0 z-40 bg-paper pt-14 flex flex-col animate-fade-in">{nav}</div>
      )}

      <main className="flex-1 md:ml-[228px] pt-14 md:pt-0 min-w-0">{children}</main>
    </div>
  )
}
