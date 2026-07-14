import Link from 'next/link'
import PublicNav from '@/components/layout/public-nav'
import { Shield, Users, Calendar, TrendingUp, CheckCircle, AlertCircle, ChevronRight } from 'lucide-react'

const RULES = [
  'You must be 18 years or older to join.',
  'You must have a steady source of income.',
  'Registration fee is non-refundable once paid.',
  'Daily contributions must be made on time — no grace period.',
  'Defaulting before your payout forfeits your slot. No consideration will be given.',
  'Do not join if you are not fully committed for the entire cycle.',
  'Each member receives their payout on their assigned date only.',
  'Ghana Card (national ID) is required for KYC verification.',
]

const HOW_IT_WORKS = [
  { step: '01', title: 'Choose a Plan', desc: 'Browse available susu groups and select one that fits your contribution budget.' },
  { step: '02', title: 'Submit Your KYC', desc: 'Provide your Ghana Card and personal details. Pay the registration fee to secure your spot.' },
  { step: '03', title: 'Get Approved', desc: 'The admin reviews your application. On approval, you receive your Member ID and passcode via SMS.' },
  { step: '04', title: 'Contribute Daily', desc: 'You receive daily SMS reminders. Pay via your secure member portal using mobile money or card.' },
  { step: '05', title: 'Receive Your Payout', desc: 'On your assigned payout date, the total pool is transferred directly to your account.' },
]

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white">
      <PublicNav />

      {/* ── HERO ── */}
      <section className="relative overflow-hidden bg-brand-green bg-kente-pattern">
        {/* Gold accent bar */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-brand-gold" />

        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28 grid md:grid-cols-2 gap-12 items-center">
          <div className="text-white space-y-6">
            <span className="inline-block px-3 py-1 text-xs font-semibold tracking-widest uppercase bg-brand-gold/20 text-brand-gold rounded-full border border-brand-gold/30">
              Trusted Community Savings
            </span>
            <h1 className="text-4xl sm:text-5xl font-extrabold leading-tight">
              Your Money,<br />
              <span className="text-brand-gold">Working Together.</span>
            </h1>
            <p className="text-lg text-green-100 max-w-md">
              Join a Susu group, make small daily contributions, and receive a lump sum payout on your assigned day. Simple. Transparent. Trusted.
            </p>
            <div className="flex flex-wrap gap-4 pt-2">
              <Link href="/plans" className="btn-primary text-base px-8 py-3.5">
                Browse Plans <ChevronRight size={18} />
              </Link>
              <Link href="/#how-it-works" className="btn-outline text-base px-8 py-3.5 border-white text-white hover:bg-white/10">
                How It Works
              </Link>
            </div>
          </div>

          {/* Stats card */}
          <div className="hidden md:grid grid-cols-2 gap-4">
            {[
              { label: 'Active Members', value: '1,200+', icon: Users },
              { label: 'Groups Running', value: '48',     icon: Calendar },
              { label: 'Paid Out (GHS)', value: '2.4M+',  icon: TrendingUp },
              { label: 'Success Rate',   value: '99.8%',  icon: Shield },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-5 text-white">
                <Icon size={22} className="text-brand-gold mb-3" />
                <div className="text-2xl font-bold">{value}</div>
                <div className="text-green-200 text-sm mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="py-20 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-brand-green">How Susu Works</h2>
            <p className="mt-3 text-gray-500 max-w-xl mx-auto">Five simple steps from sign-up to payout.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-6">
            {HOW_IT_WORKS.map(({ step, title, desc }) => (
              <div key={step} className="card p-6 hover:shadow-md transition-shadow">
                <span className="text-4xl font-extrabold text-brand-gold/30">{step}</span>
                <h3 className="mt-2 font-bold text-brand-green">{title}</h3>
                <p className="mt-2 text-sm text-gray-500">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PLANS PREVIEW ── */}
      <section className="py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-brand-green">Available Plans</h2>
          <p className="mt-3 text-gray-500 max-w-xl mx-auto">Choose a group that matches your savings goal.</p>
          <Link href="/plans" className="btn-secondary mt-8 inline-flex">
            View All Plans <ChevronRight size={18} />
          </Link>
        </div>
      </section>

      {/* ── RULES ── */}
      <section id="rules" className="py-20 bg-brand-green-light">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-3 mb-10">
            <div className="p-2 bg-brand-gold/20 rounded-xl">
              <AlertCircle className="text-brand-green" size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-extrabold text-brand-green">Rules & Requirements</h2>
              <p className="text-gray-500 text-sm">Please read carefully before joining</p>
            </div>
          </div>
          <ul className="space-y-3">
            {RULES.map((rule, i) => (
              <li key={i} className="flex items-start gap-3">
                <CheckCircle size={18} className="text-brand-green mt-0.5 shrink-0" />
                <span className="text-gray-700">{rule}</span>
              </li>
            ))}
          </ul>
          <div className="mt-10 p-5 bg-amber-50 border border-amber-200 rounded-2xl">
            <p className="text-amber-800 font-semibold text-sm">
              ⚠️ By joining, you confirm that you have read, understood, and agreed to all the rules above. There are no exceptions.
            </p>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="bg-brand-green text-white py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-brand-gold flex items-center justify-center font-bold text-brand-green text-sm">S</div>
            <span className="font-bold">SusuPlatform</span>
          </div>
          <p className="text-green-300 text-sm">© {new Date().getFullYear()} SusuPlatform. All rights reserved.</p>
          <div className="flex gap-4 text-sm text-green-300">
            <Link href="/plans" className="hover:text-white">Plans</Link>
            <Link href="/#rules" className="hover:text-white">Rules</Link>
            <Link href="/login" className="hover:text-white">Login</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
