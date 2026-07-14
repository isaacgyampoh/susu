'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import PublicNav from '@/components/layout/public-nav'
import { callFunction } from '@/lib/supabase'
import type { SusuGroup } from '@/types'
import { Users, Clock, Coins, TrendingUp, ChevronRight, Loader2, Shield } from 'lucide-react'

function statusBadge(status: string) {
  const map: Record<string, string> = { open: 'badge-green', full: 'badge-red', active: 'badge-blue' }
  return map[status] ?? 'badge-gray'
}

export default function PlansPage() {
  const [groups, setGroups]   = useState<SusuGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  useEffect(() => {
    callFunction<{ groups: SusuGroup[] }>('groups-public')
      .then(({ data, error }) => {
        if (error) setError(error)
        else setGroups(data?.groups ?? [])
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-gray-50">
      <PublicNav />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
        <div className="text-center mb-12">
          <h1 className="text-3xl sm:text-4xl font-extrabold text-brand-green">Available Susu Plans</h1>
          <p className="mt-3 text-gray-500 max-w-xl mx-auto">
            Contribute daily and receive a lump sum cashout on your assigned day. Spots are limited — join before the group fills.
          </p>
        </div>

        {loading && <div className="flex justify-center py-20"><Loader2 className="animate-spin text-brand-green" size={36} /></div>}
        {error   && <div className="text-center py-16 text-red-500">{error}</div>}
        {!loading && !error && groups.length === 0 && (
          <div className="text-center py-20 text-gray-500">No groups available right now. Check back soon!</div>
        )}

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {groups.map((group) => {
            const spotsLeft  = group.max_members - group.current_members
            const cashout    = group.cashout_amount ?? (group.contribution_amount * group.max_members * group.cycle_days)
            const totalOut   = cashout + group.registration_fee
            const isAvail    = group.status === 'open' && spotsLeft > 0

            return (
              <div key={group.id} className="card p-6 flex flex-col hover:shadow-lg transition-shadow">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h2 className="font-bold text-lg text-brand-green">{group.name}</h2>
                    {group.description && <p className="text-sm text-gray-500 mt-1">{group.description}</p>}
                  </div>
                  <span className={statusBadge(group.status)}>{group.status}</span>
                </div>

                <div className="space-y-3 flex-1">
                  <div className="flex items-center justify-between p-3 bg-brand-green-light rounded-xl">
                    <span className="text-sm text-gray-600 flex items-center gap-1.5"><Coins size={15} /> Daily Contribution</span>
                    <span className="font-bold text-brand-green">GHS {Number(group.contribution_amount).toFixed(2)}</span>
                  </div>

                  <div className="flex items-center justify-between p-3 bg-amber-50 rounded-xl">
                    <span className="text-sm text-gray-600 flex items-center gap-1.5"><TrendingUp size={15} /> Your Cashout</span>
                    <div className="text-right">
                      <span className="font-bold text-brand-gold text-lg">GHS {totalOut.toLocaleString()}</span>
                      <p className="text-xs text-gray-400">(incl. GHS {group.registration_fee} reg fee back)</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm text-gray-500">
                    <div className="flex items-center gap-1.5"><Users size={14} />{group.current_members}/{group.max_members} members</div>
                    <div className="flex items-center gap-1.5"><Clock size={14} />{group.cycle_days}-day cycles</div>
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-gray-400">
                    <Shield size={12} /> Payment deadline: {group.payment_deadline ? group.payment_deadline.slice(0, 5) : '18:00'} daily
                    {group.penalty_per_late_day && group.penalty_per_late_day > 0
                      ? <span className="text-red-500 ml-1">· GHS {group.penalty_per_late_day} late penalty</span>
                      : null
                    }
                  </div>

                  <p className="text-xs text-gray-400">Registration fee: GHS {Number(group.registration_fee).toFixed(2)} (one-time, added to your cashout)</p>
                </div>

                <div className="mt-5 pt-4 border-t border-gray-100">
                  {isAvail ? (
                    <Link href={`/join/${group.id}`} className="btn-primary w-full text-sm">
                      Join — {spotsLeft} spot{spotsLeft !== 1 ? 's' : ''} left <ChevronRight size={16} />
                    </Link>
                  ) : (
                    <button disabled className="btn-primary w-full text-sm opacity-50 cursor-not-allowed">
                      {group.status === 'full' ? 'Group Full' : group.status === 'active' ? 'Cycle In Progress' : 'Not Available'}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Rules reminder */}
        <div className="mt-12 p-6 bg-amber-50 border border-amber-200 rounded-2xl max-w-2xl mx-auto text-center">
          <p className="text-amber-800 text-sm font-medium">
            ⚠️ Before joining, make sure you have read all the <Link href="/#rules" className="underline font-bold">Rules & Regulations</Link>. The registration fee is non-refundable. Contributions must be paid before 6:00 PM daily.
          </p>
        </div>
      </div>
    </div>
  )
}
