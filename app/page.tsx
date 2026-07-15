import Link from 'next/link'
import { ArrowRight, Users, Shield } from 'lucide-react'

export default function Entry() {
  return (
    <div className="min-h-screen max-w-[420px] mx-auto px-5 flex flex-col justify-center pb-10">
      <div className="animate-slide-up">
        <div className="w-14 h-14 rounded-[16px] bg-green grid place-items-center mb-7">
          <span className="text-gold font-extrabold text-2xl">S</span>
        </div>

        <h1 className="text-[34px] font-extrabold tracking-[-.03em] leading-[1.1]">
          Save daily.<br />Collect on your day.
        </h1>
        <p className="t-meta mt-3 leading-relaxed max-w-[300px]">
          Track your contributions, see your slot in the rotation, and know exactly when you collect.
        </p>

        <div className="space-y-3 mt-9">
          <Link href="/login" className="panel p-5 flex items-center gap-4 group hover:border-green transition-colors">
            <div className="w-11 h-11 rounded-[12px] bg-green-50 grid place-items-center shrink-0">
              <Users size={19} className="text-green" />
            </div>
            <div className="flex-1">
              <p className="t-h2">Member</p>
              <p className="t-meta mt-0.5">Your plan, payments and collection date</p>
            </div>
            <ArrowRight size={17} className="text-ink-3 group-hover:text-green group-hover:translate-x-0.5 transition-all shrink-0" />
          </Link>

          <Link href="/admin/login" className="panel p-5 flex items-center gap-4 group hover:border-green transition-colors">
            <div className="w-11 h-11 rounded-[12px] bg-green-50 grid place-items-center shrink-0">
              <Shield size={19} className="text-green" />
            </div>
            <div className="flex-1">
              <p className="t-h2">Collector</p>
              <p className="t-meta mt-0.5">Manage members, groups and payouts</p>
            </div>
            <ArrowRight size={17} className="text-ink-3 group-hover:text-green group-hover:translate-x-0.5 transition-all shrink-0" />
          </Link>
        </div>

        <p className="t-meta text-center mt-8">Not a member yet? Ask your susu collector.</p>
      </div>
    </div>
  )
}
