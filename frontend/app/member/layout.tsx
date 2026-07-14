'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { clearMemberAuth } from '@/lib/supabase'
import { LayoutDashboard, CreditCard, User, LogOut, Menu, X, Bell } from 'lucide-react'
import clsx from 'clsx'

const NAV = [
  { href: '/member/dashboard', label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/member/payments',  label: 'Payments',   icon: CreditCard       },
  { href: '/member/profile',   label: 'My Profile', icon: User             },
]

export default function MemberLayout({ children }: { children: React.ReactNode }) {
  const pathname        = usePathname()
  const router          = useRouter()
  const [open, setOpen] = useState(false)
  const [user, setUser] = useState<{ full_name: string; member_id: string } | null>(null)

  useEffect(() => {
    const token = localStorage.getItem('member_token')
    if (!token) { router.replace('/login'); return }
    try {
      const u = JSON.parse(localStorage.getItem('member_user') ?? '{}')
      setUser(u)
    } catch { /* empty */ }
  }, [router])

  function logout() {
    clearMemberAuth()
    router.push('/login')
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Sidebar — desktop */}
      <aside className="hidden md:flex flex-col w-64 bg-brand-green min-h-screen">
        {/* Logo */}
        <div className="p-6 border-b border-green-800">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand-gold flex items-center justify-center">
              <span className="text-brand-green font-bold text-sm">S</span>
            </div>
            <span className="text-white font-bold">SusuPlatform</span>
          </div>
          {user && (
            <div className="mt-4">
              <p className="text-white font-semibold truncate">{user.full_name}</p>
              <p className="text-green-300 text-sm">{user.member_id}</p>
            </div>
          )}
        </div>

        {/* Nav links */}
        <nav className="flex-1 py-6 px-3 space-y-1">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}
              className={clsx(
                'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-colors',
                pathname === href
                  ? 'bg-brand-gold text-brand-green'
                  : 'text-green-200 hover:bg-green-800 hover:text-white'
              )}
            >
              <Icon size={18} /> {label}
            </Link>
          ))}
        </nav>

        <button onClick={logout} className="flex items-center gap-3 px-7 py-5 text-green-300 hover:text-white text-sm transition-colors border-t border-green-800">
          <LogOut size={18} /> Sign Out
        </button>
      </aside>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-50 bg-brand-green flex items-center justify-between px-4 h-14 shadow">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-brand-gold flex items-center justify-center font-bold text-brand-green text-sm">S</div>
          <span className="text-white font-bold text-sm">SusuPlatform</span>
        </div>
        <button onClick={() => setOpen(!open)} className="text-white p-1">
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile nav drawer */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40 bg-brand-green pt-14 px-4 py-6 space-y-2 animate-fade-in">
          {user && (
            <div className="pb-4 border-b border-green-800 mb-4">
              <p className="text-white font-semibold">{user.full_name}</p>
              <p className="text-green-300 text-sm">{user.member_id}</p>
            </div>
          )}
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} onClick={() => setOpen(false)}
              className={clsx('flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium',
                pathname === href ? 'bg-brand-gold text-brand-green' : 'text-green-200'
              )}
            >
              <Icon size={18} /> {label}
            </Link>
          ))}
          <button onClick={logout} className="flex items-center gap-3 px-4 py-3 text-green-300 text-sm w-full">
            <LogOut size={18} /> Sign Out
          </button>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 md:overflow-auto pt-14 md:pt-0">
        {children}
      </main>
    </div>
  )
}
