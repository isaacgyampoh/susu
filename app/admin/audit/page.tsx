'use client'
import { useEffect, useState } from 'react'
import { callFunction, getAdminToken } from '@/lib/supabase'
import { format } from 'date-fns'
type Entry = {
  id: string; admin_name: string; action: string
  entity_type: string; entity_label: string
  details: any; created_at: string
}

function actionMeta(action: string) {
  if (action.startsWith('payout'))     return { color: 'text-ink bg-tint', label: 'Payout' }
  if (action.startsWith('membership')) return { color: 'text-red bg-tint',         label: 'Forfeiture' }
  if (action.startsWith('member'))     return { color: 'text-ink bg-tint',       label: 'Member' }
  if (action.startsWith('group'))      return { color: 'text-ink-2 bg-tint',     label: 'Group' }
  return { color: 'text-ink-2 bg-tint', label: 'System' }
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
    <div className="px-5 sm:px-8 lg:px-10 py-7 pb-16 animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-ink">Audit Log</h1>
        <p className="text-ink-2 text-sm mt-1">Every money-related action, permanently recorded</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-20">'…'</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-20 text-ink-2">
          <p>No activity recorded yet</p>
          <p className="text-xs text-ink-3 mt-1">Payouts and forfeitures will appear here</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {entries.map(e => {
              const { color, label } = actionMeta(e.action)
              return (
                <div key={e.id} className="bg-paper border border-line rounded-[10px] p-4 flex gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div>
                        <p className="text-ink text-sm font-medium">{e.entity_label || e.action}</p>
                        <p className="text-ink-2 text-xs mt-0.5">
                          <span className="text-ink-2">{label}</span> · by {e.admin_name}
                        </p>
                      </div>
                      <span className="text-xs text-ink-3 shrink-0">{format(new Date(e.created_at), 'MMM d · HH:mm')}</span>
                    </div>
                    {e.details && (
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        {e.details.net !== undefined && (
                          <span className="text-ink-2">Net: <span className="text-ink font-medium">GHS {Number(e.details.net).toLocaleString()}</span></span>
                        )}
                        {e.details.deductions > 0 && (
                          <span className="text-ink-2">Deducted: <span className="text-red font-medium">GHS {Number(e.details.deductions).toFixed(2)}</span></span>
                        )}
                        {e.details.reason && <span className="text-ink-2">Reason: <span className="text-ink">{e.details.reason}</span></span>}
                        {e.details.ref && <span className="text-ink-3 font-mono">{e.details.ref}</span>}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {total > 50 && (
            <div className="flex items-center justify-between mt-5">
              <span className="text-sm text-ink-2">Page {page} · {total} entries</span>
              <div className="flex gap-2">
                <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}
                  className="px-3 py-1.5 text-sm bg-tint text-ink-2 rounded-lg disabled:opacity-40 hover:text-ink">Prev</button>
                <button onClick={() => setPage(p => p+1)} disabled={page*50>=total}
                  className="px-3 py-1.5 text-sm bg-tint text-ink-2 rounded-lg disabled:opacity-40 hover:text-ink">Next</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
