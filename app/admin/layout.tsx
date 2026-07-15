'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { clearAdminAuth } from '@/lib/supabase'
import {
  LayoutDashboard, BarChart3, Users, Layers, ClipboardList,
  TrendingUp, MessageCircle, Megaphone, FileDown, ScrollText, ShieldCheck,
  Menu, X, LogOut, UserPlus,
} from 'lucide-react'

const NAV = [
  { href: '/admin',               label: 'Dashboard',     icon: LayoutDashboard, exact: true },
  { href: '/admin/analytics',     label: 'Analytics',     icon: BarChart3 },
  { href: '/admin/members',       label: 'Members',       icon: Users },
  { href: '/admin/groups',        label: 'Groups',        icon: Layers },
  { href: '/admin/contributions', label: 'Contributions', icon: ClipboardList },
  { href: '/admin/payouts',       label: 'Payouts',       icon: TrendingUp },
  { href: '/admin/messages',      label: 'Messages',      icon: MessageCircle },
  { href: '/admin/announcements', label: 'Announcements', icon: Megaphone },
  { href: '/admin/reports',       label: 'Reports',       icon: FileDown },
  { href: '/admin/audit',         label: 'Audit log',     icon: ScrollText },
  { href: '/admin/kyc',           label: 'KYC review',    icon: ShieldCheck },
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
          <div className="w-9 h-9 rounded-[10px] bg-green grid place-items-center">
            <span className="text-gold font-extrabold text-[15px]">S</span>
          </div>
          <span className="font-extrabold text-[15px]">Susu</span>
        </Link>
        {admin && (
          <div className="mt-5 p-3 bg-green-50 rounded-[12px]">
            <p className="text-[13px] font-bold truncate">{admin.full_name}</p>
            <p className="text-[11px] text-green font-semibold capitalize mt-0.5">{admin.role?.replace('_', ' ')}</p>
          </div>
        )}
        <Link href="/admin/members/new" onClick={() => setOpen(false)} className="act-primary act-sm w-full mt-3">
          <UserPlus size={14} /> Add member
        </Link>
      </div>

      <nav className="flex-1 px-3 overflow-y-auto space-y-0.5">
        {NAV.map(({ href, label, icon: Icon, exact }) => (
          <Link key={href} href={href} onClick={() => setOpen(false)}
            className={`flex items-center gap-2.5 px-3 h-10 rounded-[10px] text-[13.5px] transition-colors ${
              active(href, exact) ? 'bg-green text-white font-bold' : 'text-ink-2 font-medium hover:bg-green-50 hover:text-ink'
            }`}>
            <Icon size={16} /> {label}
          </Link>
        ))}
      </nav>

      <div className="px-3 py-4 border-t border-line">
        <button onClick={() => { clearAdminAuth(); router.push('/admin/login') }}
          className="flex items-center gap-2.5 px-3 h-10 w-full rounded-[10px] text-[13.5px] font-medium text-ink-2 hover:bg-red-50 hover:text-red transition-colors">
          <LogOut size={16} /> Sign out
        </button>
      </div>
    </>
  )

  return (
    <div className="min-h-screen flex">
      <aside className="hidden md:flex flex-col w-[244px] bg-surface border-r border-line fixed inset-y-0">{nav}</aside>

      <div className="md:hidden fixed top-0 inset-x-0 z-50 h-14 bg-surface border-b border-line flex items-center justify-between px-5">
        <span className="font-extrabold text-[15px]">Susu</span>
        <button onClick={() => setOpen(!open)} aria-label={open ? 'Close menu' : 'Open menu'} className="text-ink">
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
      {open && <div className="md:hidden fixed inset-0 z-40 bg-surface pt-14 flex flex-col animate-fade-in">{nav}</div>}

      <main className="flex-1 md:ml-[244px] pt-14 md:pt-0 min-w-0">{children}</main>
    </div>
  )
}