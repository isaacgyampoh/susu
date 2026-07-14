import Link from 'next/link'
import { ArrowRight, Shield, Users } from 'lucide-react'

export default function PortalEntryPage() {
  return (
    <div className="min-h-screen bg-brand-green bg-kente-pattern flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">

        {/* Logo */}
        <div className="mb-10">
          <div className="w-20 h-20 rounded-3xl bg-brand-gold flex items-center justify-center mx-auto mb-4 shadow-2xl">
            <span className="text-brand-green font-extrabold text-4xl">S</span>
          </div>
          <h1 className="text-white text-3xl font-extrabold">SusuPlatform</h1>
          <p className="text-green-300 mt-2">Community Savings Portal</p>
        </div>

        {/* Entry cards */}
        <div className="space-y-4">
          {/* Member login */}
          <Link href="/login"
            className="flex items-center justify-between w-full p-5 bg-brand-gold rounded-2xl hover:bg-amber-400 transition-all active:scale-95 group">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-brand-green/20 flex items-center justify-center">
                <Users size={22} className="text-brand-green" />
              </div>
              <div className="text-left">
                <p className="font-bold text-brand-green text-base">Member Portal</p>
                <p className="text-green-800 text-sm">View your plans, pay contributions</p>
              </div>
            </div>
            <ArrowRight size={20} className="text-brand-green group-hover:translate-x-1 transition-transform" />
          </Link>

          {/* Admin login */}
          <Link href="/admin/login"
            className="flex items-center justify-between w-full p-5 bg-white/10 border border-white/20 rounded-2xl hover:bg-white/20 transition-all active:scale-95 group backdrop-blur">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center">
                <Shield size={22} className="text-white" />
              </div>
              <div className="text-left">
                <p className="font-bold text-white text-base">Admin Dashboard</p>
                <p className="text-green-300 text-sm">Manage members, groups & payouts</p>
              </div>
            </div>
            <ArrowRight size={20} className="text-green-300 group-hover:translate-x-1 transition-transform" />
          </Link>
        </div>

        <p className="text-green-400 text-xs mt-10">
          Not a member yet? Contact your Susu admin to get started.
        </p>
      </div>
    </div>
  )
}
