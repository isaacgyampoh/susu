'use client'
import { useEffect, useState } from 'react'
import { callFunction, getAdminToken } from '@/lib/supabase'
import { format } from 'date-fns'
import { Loader2, Shield, User, Wallet, UserX, Layers } from 'lucide-react'

type Entry = {
  id: string; admin_name: string; action: string
  entity_type: string; entity_label: string
  details: any; created_at: string
}

function actionMeta(action: string) {
  if (action.startsWith('payout'))     return { icon: Wallet, color: 'text-emerald-400 bg-emerald-900/40', label: 'Payout' }
  if (action.startsWith('membership')) return { icon: UserX,  color: 'text-red-400 bg-red-900/40',         label: 'Forfeiture' }
  if (action.startsWith('member'))     return { icon: User,   color: 'text-blue-400 bg-blue-900/40',       label: 'Member' }
  if (action.startsWith('group'))      return { icon: Layers, color: 'text-amber-400 bg-amber-900/40',     label: 'Group' }
  return { icon: Shield, color: 'text-gray-400 bg-gray-800', label: 'System' }
}

export default function AuditPage() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage]       = useState(1)
  const [total, setTotal]     = useState(0)

  useEffect(() => {
    setLoading(true)
    const token = getAdminToken()
    callFunction<{ entries: Entry[]; total: number }>(`admin-audit?page=${page}`, { token: token! })
      .then(({ data }) => { setEntries(data?.entries ?? []); setTotal(data?.total ?? 0) })
      .finally(() => setLoading(false))
  }, [page])

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto pb-12 animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-white">Audit Log</h1>
        <p className="text-gray-400 text-sm mt-1">Every money-related action, permanently recorded</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><Loader2 className="animate-spin text-brand-gold" size={32} /></div>
      ) : entries.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <Shield size={40} className="mx-auto mb-3 opacity-20" />
          <p>No activity recorded yet</p>
          <p className="text-xs text-gray-600 mt-1">Payouts and forfeitures will appear here</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {entries.map(e => {
              const { icon: Icon, color, label } = actionMeta(e.action)
              return (
                <div key={e.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
                    <Icon size={16} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div>
                        <p className="text-white text-sm font-medium">{e.entity_label || e.action}</p>
                        <p className="text-gray-500 text-xs mt-0.5">
                          <span className="text-gray-400">{label}</span> · by {e.admin_name}
                        </p>
                      </div>
                      <span className="text-xs text-gray-600 shrink-0">{format(new Date(e.created_at), 'MMM d · HH:mm')}</span>
                    </div>
                    {e.details && (
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        {e.details.net !== undefined && (
                          <span className="text-gray-400">Net: <span className="text-brand-gold font-medium">GHS {Number(e.details.net).toLocaleString()}</span></span>
                        )}
                        {e.details.deductions > 0 && (
                          <span className="text-gray-400">Deducted: <span className="text-red-400 font-medium">GHS {Number(e.details.deductions).toFixed(2)}</span></span>
                        )}
                        {e.details.reason && <span className="text-gray-400">Reason: <span className="text-gray-300">{e.details.reason}</span></span>}
                        {e.details.ref && <span className="text-gray-600 font-mono">{e.details.ref}</span>}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {total > 50 && (
            <div className="flex items-center justify-between mt-5">
              <span className="text-sm text-gray-500">Page {page} · {total} entries</span>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}
                  className="px-3 py-1.5 text-sm bg-gray-800 text-gray-400 rounded-lg disabled:opacity-40 hover:text-white">Prev</button>
                <button onClick={() => setPage(p => p+1)} disabled={page*50>=total}
                  className="px-3 py-1.5 text-sm bg-gray-800 text-gray-400 rounded-lg disabled:opacity-40 hover:text-white">Next</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
