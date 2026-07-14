import Link from 'next/link'
import PublicNav from '@/components/layout/public-nav'
import { Shield, Users, Calendar, TrendingUp, CheckCircle, AlertTriangle, ChevronRight, Clock, CreditCard, Bell, User, Phone } from 'lucide-react'

const RULES = [
  { rule: 'No refund after registration. The GHS 110 registration fee is non-refundable once paid.', strict: true },
  { rule: 'You must be 18 years or older to join. No exceptions.', strict: true },
  { rule: 'You must have a steady, verifiable source of income.', strict: false },
  { rule: 'The system automatically assigns your group slot when the group fills up.', strict: false },
  { rule: 'Do not join if you are not fully committed to completing the entire cycle.', strict: true },
  { rule: 'No consideration will be given when you default. Your slot is immediately forfeited.', strict: true },
  { rule: 'Contributions MUST be paid before 6:00 PM every day. Late payments are automatically flagged by the system.', strict: true },
  { rule: 'A penalty is applied for every late payment.', strict: true },
  { rule: 'You must agree to all Terms & Conditions before joining. By joining, you are bound by these rules.', strict: false },
  { rule: 'All members must complete the full savings cycle.', strict: true },
  { rule: 'A valid Ghana Card (national ID) is required for identity verification.', strict: false },
  { rule: 'Your registration fee will be added to your cashout amount on your assigned payout day.', strict: false },
]

const HOW_IT_WORKS = [
  { step: '01', title: 'Choose a Plan', desc: 'Browse available Susu groups and select one that fits your daily budget.' },
  { step: '02', title: 'Submit KYC', desc: 'Upload your Ghana Card and fill in your details. Pay the registration fee (GHS 110) to secure your place.' },
  { step: '03', title: 'Get Approved', desc: 'Your application is reviewed. On approval you receive your Member ID and login passcode via SMS.' },
  { step: '04', title: 'Contribute Daily', desc: 'Pay your daily contribution through the member portal before 6:00 PM. You\'ll get SMS reminders.' },
  { step: '05', title: 'Receive Your Payout', desc: 'On your assigned date, your cashout is sent directly to you. Your registration fee is included.' },
]

const PORTAL_FEATURES = [
  { icon: TrendingUp, label: 'Your active Susu plans & schedules' },
  { icon: CreditCard, label: 'Payment history & balance per plan' },
  { icon: Clock,      label: 'Next payment due with 6PM deadline' },
  { icon: Calendar,   label: 'Your exact cashout date & amount' },
  { icon: CheckCircle, label: 'Receipts & transaction records' },
  { icon: Bell,       label: 'Announcements, reminders & updates' },
  { icon: User,       label: 'Personal profile — name, number, ID' },
  { icon: Phone,      label: 'Contact admin directly from portal' },
]

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white">
      <PublicNav />

      {/* HERO */}
      <section className="relative overflow-hidden bg-brand-green bg-kente-pattern">
        <div className="absolute top-0 left-0 right-0 h-1 bg-brand-gold" />
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28 grid md:grid-cols-2 gap-12 items-center">
          <div className="text-white space-y-6">
            <span className="inline-block px-3 py-1 text-xs font-semibold tracking-widest uppercase bg-brand-gold/20 text-brand-gold rounded-full border border-brand-gold/30">
              Trusted Community Savings · Ghana
            </span>
            <h1 className="text-4xl sm:text-5xl font-extrabold leading-tight">
              Save Daily.<br />
              <span className="text-brand-gold">Cash Out Big.</span>
            </h1>
            <p className="text-lg text-green-100 max-w-md">
              Join a Susu group, contribute GHS 55 every day, and receive your full cashout of <strong className="text-brand-gold">GHS 16,430</strong> on your assigned day — plus your registration fee back.
            </p>
            <div className="flex flex-wrap gap-4 pt-2">
              <Link href="/plans" className="btn-primary text-base px-8 py-3.5">
                Join a Group <ChevronRight size={18} />
              </Link>
              <Link href="/#how-it-works" className="inline-flex items-center gap-2 px-8 py-3.5 border-2 border-white/50 text-white font-semibold rounded-xl hover:bg-white/10 transition-all">
                How It Works
              </Link>
            </div>
          </div>

          {/* Stats */}
          <div className="hidden md:grid grid-cols-2 gap-4">
            {[
              { label: 'Daily Contribution', value: 'GHS 55',    icon: CreditCard },
              { label: 'Your Cashout',       value: 'GHS 16,430', icon: TrendingUp },
              { label: 'Cycle Duration',     value: '30 Days',   icon: Calendar },
              { label: 'Group Size',         value: '11 Members', icon: Users },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="bg-white/10 backdrop-blur border border-white/20 rounded-2xl p-5 text-white">
                <Icon size={20} className="text-brand-gold mb-3" />
                <div className="text-2xl font-bold">{value}</div>
                <div className="text-green-200 text-sm mt-0.5">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="how-it-works" className="py-20 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-brand-green">How It Works</h2>
            <p className="mt-3 text-gray-500 max-w-xl mx-auto">From sign-up to cashout in five simple steps.</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-5">
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

      {/* WHAT YOU SEE IN YOUR PORTAL */}
      <section className="py-20">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-brand-green mb-3">Your Member Portal</h2>
            <p className="text-gray-500 mb-8">Everything you need to track your savings, in one secure place.</p>
            <ul className="space-y-3">
              {PORTAL_FEATURES.map(({ icon: Icon, label }) => (
                <li key={label} className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-brand-green-light flex items-center justify-center shrink-0">
                    <Icon size={17} className="text-brand-green" />
                  </div>
                  <span className="text-gray-700">{label}</span>
                </li>
              ))}
            </ul>
            <Link href="/login" className="btn-secondary mt-8 inline-flex">
              Access Your Portal <ChevronRight size={18} />
            </Link>
          </div>
          <div className="card p-6 bg-brand-green text-white space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-green-300 text-sm">Your next cashout</p>
                <p className="text-3xl font-extrabold text-brand-gold">GHS 16,540</p>
                <p className="text-green-200 text-sm mt-1">includes GHS 110 registration fee</p>
              </div>
              <Calendar size={40} className="text-white/20" />
            </div>
            <div className="border-t border-green-700 pt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-green-300">Member ID</span><span className="font-mono">SSU-0042</span></div>
              <div className="flex justify-between"><span className="text-green-300">Active Plans</span><span>2 groups</span></div>
              <div className="flex justify-between"><span className="text-green-300">Today's deadline</span><span className="text-brand-gold font-bold">6:00 PM</span></div>
              <div className="flex justify-between"><span className="text-green-300">Balance paid</span><span className="text-emerald-400">GHS 1,100 / 1,650</span></div>
            </div>
          </div>
        </div>
      </section>

      {/* PLANS PREVIEW */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 text-center">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-brand-green">Available Plans</h2>
          <p className="mt-3 text-gray-500 max-w-xl mx-auto">Browse open Susu groups and secure your spot before they fill up.</p>
          <Link href="/plans" className="btn-secondary mt-8 inline-flex">
            View All Plans <ChevronRight size={18} />
          </Link>
        </div>
      </section>

      {/* RULES */}
      <section id="rules" className="py-20 bg-brand-green-light">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="flex items-center gap-3 mb-10">
            <div className="p-2 bg-brand-gold/20 rounded-xl">
              <Shield className="text-brand-green" size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-extrabold text-brand-green">Rules & Regulations</h2>
              <p className="text-gray-500 text-sm">Read every rule carefully before you join</p>
            </div>
          </div>
          <ul className="space-y-3">
            {RULES.map(({ rule, strict }, i) => (
              <li key={i} className={`flex items-start gap-3 p-3 rounded-xl ${strict ? 'bg-red-50 border border-red-100' : 'bg-white border border-gray-100'}`}>
                {strict
                  ? <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" />
                  : <CheckCircle size={18} className="text-brand-green mt-0.5 shrink-0" />
                }
                <span className={strict ? 'text-red-800 text-sm' : 'text-gray-700 text-sm'}>{rule}</span>
              </li>
            ))}
          </ul>
          <div className="mt-8 p-5 bg-amber-50 border border-amber-200 rounded-2xl">
            <p className="text-amber-800 font-semibold text-sm">
              ⚠️ By submitting your application and paying the registration fee, you confirm you have read, understood, and agreed to every rule above. There are no exceptions and no refunds.
            </p>
          </div>
          <Link href="/plans" className="btn-secondary w-full text-center mt-6 flex justify-center">
            I Understand — Show Me the Plans <ChevronRight size={18} />
          </Link>
        </div>
      </section>

      {/* FOOTER */}
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
            <Link href="/login" className="hover:text-white">Member Login</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
