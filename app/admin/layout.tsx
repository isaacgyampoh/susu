'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { clearAdminAuth } from '@/lib/supabase'
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
      <div className="px-5 pt-6 pb-5">
        <Link href="/admin" className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-[10px] bg-blue grid place-items-center">
            <span className="text-white font-extrabold text-[15px]">S</span>
          </div>
          <span className="font-extrabold text-[15px]">Susu</span>
        </Link>
        {admin && (
          <div className="mt-5 p-3 bg-blue-lt rounded-[12px]">
            <p className="text-[13px] font-bold truncate">{admin.full_name}</p>
            <p className="text-[11px] text-blue font-semibold capitalize mt-0.5">{admin.role?.replace('_', ' ')}</p>
          </div>
        )}
        <Link href="/admin/members/new" onClick={() => setOpen(false)} className="act-primary act-sm w-full mt-3">
          Add member
        </Link>
      </div>

      <nav className="flex-1 px-3 overflow-y-auto space-y-0.5">
        {NAV.map(({ href, label, exact }) => (
          <Link key={href} href={href} onClick={() => setOpen(false)}
            className={`flex items-center gap-2.5 px-3 h-10 rounded-[10px] text-[13.5px] transition-colors ${
              active(href, exact) ? 'bg-blue text-white font-bold' : 'text-ink-2 font-medium hover:bg-blue-lt hover:text-ink'
            }`}>
            {label}
          </Link>
        ))}
      </nav>

      <div className="px-3 py-4 border-t border-line">
        <button onClick={() => { clearAdminAuth(); router.push('/admin/login') }}
          className="flex items-center gap-2.5 px-3 h-10 w-full rounded-[10px] text-[13.5px] font-medium text-ink-2 hover:bg-red-50 hover:text-red transition-colors">
          Sign out
        </button>
      </div>
    </>
  )

  return (
    <div className="min-h-screen flex">
      <aside className="hidden md:flex flex-col w-[244px] bg-paper border-r border-line fixed inset-y-0">{nav}</aside>

      <div className="md:hidden fixed top-0 inset-x-0 z-50 h-14 bg-paper border-b border-line flex items-center justify-between px-5">
        <span className="font-extrabold text-[15px]">Susu</span>
        <button onClick={() => setOpen(!open)} aria-label={open ? 'Close menu' : 'Open menu'} className="text-ink">
          {open ? '' : ''}
        </button>
      </div>
      {open && <div className="md:hidden fixed inset-0 z-40 bg-paper pt-14 flex flex-col animate-fade-in">{nav}</div>}

      <main className="flex-1 md:ml-[244px] pt-14 md:pt-0 min-w-0">{children}</main>
    </div>
  )
}