'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { clearAdminAuth } from '@/lib/supabase'
import clsx from 'clsx'
import {
  LayoutDashboard, Users, Layers, ClipboardList, TrendingUp,
  Megaphone, MessageCircle, ShieldCheck, LogOut, Menu, X, UserPlus,
  BarChart3, FileDown, ScrollText
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
  { href: '/admin/audit',         label: 'Audit Log',     icon: ScrollText },
  { href: '/admin/kyc',           label: 'KYC Review',    icon: ShieldCheck },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname          = usePathname()
  const router            = useRouter()
  const [open, setOpen]   = useState(false)
  const [admin, setAdmin] = useState<{ full_name: string; role: string } | null>(null)

  // Login page renders without the sidebar
  const isLoginPage = pathname === '/admin/login'

  useEffect(() => {
    if (isLoginPage) return
    const token = localStorage.getItem('admin_token')
    if (!token) { router.replace('/admin/login'); return }
    try { setAdmin(JSON.parse(localStorage.getItem('admin_user') ?? '{}')) } catch { /* noop */ }
  }, [router, isLoginPage])

  if (isLoginPage) return <>{children}</>

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href)

  function logout() { clearAdminAuth(); router.push('/admin/login') }

  const sidebar = (
    <>
      <div className="p-6 border-b border-gray-800">
        <Link href="/admin" className="flex items-center gap-2 mb-4">
          <div className="w-8 h-8 rounded-lg bg-brand-gold flex items-center justify-center">
            <span className="text-brand-green font-bold text-sm">S</span>
          </div>
          <span className="font-bold text-white">Admin Panel</span>
        </Link>
        {admin && (
          <div>
            <p className="text-white font-semibold text-sm truncate">{admin.full_name}</p>
            <span className="text-xs text-brand-gold font-medium capitalize">{admin.role?.replace('_', ' ')}</span>
          </div>
        )}
      </div>

      {/* Quick action */}
      <div className="px-3 pt-4">
        <Link href="/admin/members/new" onClick={() => setOpen(false)}
          className="flex items-center justify-center gap-2 w-full py-2.5 bg-brand-gold text-brand-green font-semibold rounded-xl text-sm hover:bg-amber-400 transition-colors">
          <UserPlus size={16} /> Add Member
        </Link>
      </div>

      <nav className="flex-1 py-4 px-3 space-y-0.5">
        {NAV.map(({ href, label, icon: Icon, exact }) => (
          <Link key={href} href={href} onClick={() => setOpen(false)}
            className={clsx(
              'flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors',
              isActive(href, exact)
                ? 'bg-brand-gold text-brand-green'
                : 'text-gray-400 hover:bg-gray-800 hover:text-white'
            )}>
            <Icon size={17} /> {label}
          </Link>
        ))}
      </nav>

      <button onClick={logout}
        className="flex items-center gap-3 px-7 py-4 text-gray-500 hover:text-white text-sm transition-colors border-t border-gray-800 w-full">
        <LogOut size={17} /> Sign Out
      </button>
    </>
  )

  return (
    <div className="min-h-screen bg-gray-950 flex">
      <aside className="hidden md:flex flex-col w-60 bg-gray-900 border-r border-gray-800 min-h-screen fixed">
        {sidebar}
      </aside>

      <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-4 h-14">
        <span className="font-bold text-white text-sm">Admin Panel</span>
        <button onClick={() => setOpen(!open)} className="text-gray-400 p-1">
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {open && (
        <div className="md:hidden fixed inset-0 z-40 bg-gray-900 flex flex-col pt-14 animate-fade-in overflow-y-auto">
          {sidebar}
        </div>
      )}

      <main className="flex-1 md:ml-60 pt-14 md:pt-0 overflow-auto">
        {children}
      </main>
    </div>
  )
}
