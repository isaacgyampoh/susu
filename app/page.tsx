import Link from 'next/link'
import { ArrowRight, Shield } from 'lucide-react'

export default function PortalEntry() {
  return (
    <div className="min-h-screen flex flex-col px-5 max-w-lg mx-auto">
      <div className="flex-1 flex flex-col justify-center py-12 animate-slide-up">
        <div className="w-12 h-12 rounded-2xl bg-forest grid place-items-center mb-8">
          <span className="text-gold font-extrabold text-xl">S</span>
        </div>

        <h1 className="display text-[44px] mb-3">
          Save together,
          <br />
          <span className="text-forest">collect big.</span>
        </h1>
        <p className="text-muted text-[15px] mb-10 max-w-sm">
          Track your contributions, watch the rotation, and know exactly when your turn comes.
        </p>

        <Link href="/login" className="sheet p-5 flex items-center justify-between mb-3 group transition-transform active:scale-[0.99]">
          <div>
            <p className="font-bold text-[16px]">Member portal</p>
            <p className="text-muted text-[13px] mt-0.5">Your plans, payments and payout date</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-gold grid place-items-center shrink-0">
            <ArrowRight size={17} className="text-ink group-hover:translate-x-0.5 transition-transform" />
          </div>
        </Link>

        <Link href="/admin/login" className="sheet-flat p-5 flex items-center justify-between group transition-transform active:scale-[0.99]">
          <div>
            <p className="font-bold text-[16px]">Admin</p>
            <p className="text-muted text-[13px] mt-0.5">Manage members, groups and payouts</p>
          </div>
          <div className="w-10 h-10 rounded-full bg-canvas grid place-items-center shrink-0">
            <Shield size={16} className="text-forest" />
          </div>
        </Link>
      </div>

      <p className="pb-8 text-center text-[13px] text-muted">
        Not a member yet? Contact your Susu admin.
      </p>
    </div>
  )
}
