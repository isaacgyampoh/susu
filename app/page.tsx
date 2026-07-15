import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

export default function Entry() {
  return (
    <div className="min-h-screen flex flex-col max-w-[430px] mx-auto px-[18px]">
      <div className="flex-1 flex flex-col justify-center py-12 animate-slide-up">
        <p className="stencil text-dim-field mb-3">Susu Platform</p>
        <h1 className="text-[44px] font-black tracking-[-.04em] leading-[.92] mb-4">
          Pay daily.<br />
          <span className="text-gold">Collect big.</span>
        </h1>
        <p className="text-dim-field text-[14px] font-medium mb-10 max-w-[300px]">
          Your card, your slot, your collection date — all in one place.
        </p>

        <Link href="/login" className="card-stock p-5 flex items-center justify-between mb-2.5 group">
          <div>
            <p className="stencil text-dim">Members</p>
            <p className="text-[17px] font-extrabold mt-0.5">Open your card</p>
          </div>
          <div className="w-9 h-9 rounded-[3px] bg-gold grid place-items-center shrink-0">
            <ArrowRight size={16} className="text-ink group-hover:translate-x-0.5 transition-transform" />
          </div>
        </Link>

        <Link href="/admin/login" className="border border-white/15 rounded-[4px] p-5 flex items-center justify-between hover:bg-white/5 transition-colors">
          <div>
            <p className="stencil text-dim-field">Collector</p>
            <p className="text-[17px] font-extrabold mt-0.5">Admin console</p>
          </div>
          <ArrowRight size={16} className="text-dim-field shrink-0" />
        </Link>
      </div>
      <p className="pb-8 text-center text-[12px] font-medium text-dim-field">
        Not a member? Ask your susu collector.
      </p>
    </div>
  )
}
