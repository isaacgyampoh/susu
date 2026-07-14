'use client'
import { useEffect, useState } from 'react'
import { callFunction, getMemberToken } from '@/lib/supabase'
import type { MemberDashboard } from '@/types'
import { format } from 'date-fns'
import { Loader2, User, Phone, Mail, MapPin, CreditCard, Building2, Calendar, Shield } from 'lucide-react'

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-50 last:border-0">
      <div className="w-8 h-8 rounded-lg bg-brand-green-light flex items-center justify-center shrink-0">
        <Icon size={15} className="text-brand-green" />
      </div>
      <div>
        <p className="text-xs text-gray-400 font-medium">{label}</p>
        <p className="text-gray-800 font-medium mt-0.5">{value}</p>
      </div>
    </div>
  )
}

export default function ProfilePage() {
  const [data, setData]       = useState<MemberDashboard | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = getMemberToken()
    callFunction<MemberDashboard>('member-profile', { token: token! })
      .then(({ data }) => setData(data))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex justify-center py-32"><Loader2 className="animate-spin text-brand-green" size={32} /></div>
  )
  if (!data) return <div className="p-8 text-center text-gray-500">Could not load profile.</div>

  const { member, memberships, payouts } = data

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto pb-12 animate-fade-in">
      {/* Profile header */}
      <div className="card p-6 mb-6 bg-gradient-to-r from-brand-green to-brand-green-mid text-white">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-brand-gold flex items-center justify-center">
            <span className="text-brand-green font-extrabold text-2xl">{member.full_name[0]}</span>
          </div>
          <div>
            <h1 className="text-xl font-bold">{member.full_name}</h1>
            <p className="text-green-200 text-sm">{member.member_id}</p>
            <span className="inline-block mt-1 px-2.5 py-0.5 text-xs font-semibold bg-brand-gold text-brand-green rounded-full">
              {member.status}
            </span>
          </div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Personal info */}
        <div className="card p-5">
          <h2 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
            <User size={17} className="text-brand-green" /> Personal Details
          </h2>
          <InfoRow icon={Phone}    label="Phone Number"     value={member.phone} />
          <InfoRow icon={Mail}     label="Email Address"    value={member.email} />
          <InfoRow icon={MapPin}   label="Address"          value={member.residential_address} />
          <InfoRow icon={Building2} label="Occupation"      value={member.occupation} />
          <InfoRow icon={Calendar} label="Member Since"     value={format(new Date(member.created_at), 'MMMM d, yyyy')} />
        </div>

        {/* Payment info */}
        <div className="card p-5">
          <h2 className="font-bold text-gray-800 mb-3 flex items-center gap-2">
            <CreditCard size={17} className="text-brand-green" /> Payment Details
          </h2>
          <InfoRow icon={Phone}    label="Mobile Money Number"   value={member.mobile_money_number} />
          <InfoRow icon={Building2} label="Mobile Money Provider" value={member.mobile_money_provider} />
          <InfoRow icon={Building2} label="Bank Name"             value={member.bank_name} />
          <InfoRow icon={CreditCard} label="Account Number"       value={member.bank_account_number} />
          <InfoRow icon={User}     label="Account Name"           value={member.bank_account_name} />
        </div>
      </div>

      {/* Active memberships */}
      {memberships.length > 0 && (
        <div className="card p-5 mt-6">
          <h2 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
            <Shield size={17} className="text-brand-green" /> Active Susu Plans
          </h2>
          <div className="space-y-3">
            {memberships.map(m => (
              <div key={m.id} className="p-4 bg-brand-green-light rounded-xl">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-brand-green">{m.susu_groups?.name}</p>
                    <p className="text-sm text-gray-500 mt-0.5">
                      Position #{m.payout_position} · GHS {m.susu_groups?.contribution_amount}/{m.susu_groups?.contribution_frequency}
                    </p>
                    {m.joined_at && <p className="text-xs text-gray-400 mt-1">Joined {format(new Date(m.joined_at), 'MMM d, yyyy')}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    {m.payout_date && <p className="text-xs text-gray-500">Payout: {format(new Date(m.payout_date), 'MMM d, yyyy')}</p>}
                    {m.payout_amount && <p className="font-bold text-brand-gold">GHS {Number(m.payout_amount).toLocaleString()}</p>}
                    <span className={m.payout_received ? 'badge-green' : 'badge-blue'}>{m.payout_received ? 'Received' : 'Upcoming'}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Payout history */}
      {payouts.length > 0 && (
        <div className="card p-5 mt-6">
          <h2 className="font-bold text-gray-800 mb-4">Payout Schedule</h2>
          <div className="space-y-2">
            {payouts.map(p => (
              <div key={p.id} className="flex items-center justify-between p-3 rounded-xl bg-gray-50">
                <div>
                  <p className="text-sm font-medium text-gray-800">{p.susu_groups?.name}</p>
                  <p className="text-xs text-gray-400">{format(new Date(p.scheduled_date), 'EEEE, MMMM d, yyyy')}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-gray-900">GHS {Number(p.total_amount).toLocaleString()}</span>
                  <span className={p.status === 'paid' ? 'badge-green' : p.status === 'processing' ? 'badge-blue' : 'badge-gold'}>{p.status}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-center text-xs text-gray-400 mt-6">
        To update your personal information, contact the Susu admin.
      </p>
    </div>
  )
}
