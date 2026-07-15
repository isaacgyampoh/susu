'use client'
import { useEffect, useState } from 'react'
import { callFunction, getAdminToken } from '@/lib/supabase'
import type { SusuGroup } from '@/types'
const REPORTS = [
  { id: 'contributions', label: 'Contributions',   desc: 'Every contribution with status, dates, penalties and references',   color: 'text-ink bg-tint' },
  { id: 'payouts',       label: 'Payouts',         desc: 'All payouts with gross, deductions, net and MoMo numbers', color: 'text-ink bg-tint' },
  { id: 'members',       label: 'Members',         desc: 'Full member register with contact and KYC details',      color: 'text-ink-2 bg-tint' },
  { id: 'defaulters',    label: 'Defaulters',      desc: 'Forfeited members with reasons and dates',      color: 'text-red bg-tint' },
]

export default function ReportsPage() {
  const [groups, setGroups]     = useState<SusuGroup[]>([])
  const [groupId, setGroupId]   = useState('')
  const [downloading, setDownloading] = useState<string | null>(null)

  useEffect(() => {
    const token = getAdminToken()
    callFunction<{ groups: SusuGroup[] }>('groups-create', { token: token! })
      .then(({ data }) => setGroups(data?.groups ?? []))
  }, [])

  async function download(reportId: string) {
    setDownloading(reportId)
    const token = getAdminToken()
    const base  = process.env.NEXT_PUBLIC_SUPABASE_URL
    const params = new URLSearchParams({ report: reportId })
    if (groupId && reportId !== 'members') params.set('group_id', groupId)

    try {
      const res = await fetch(`${base}/functions/v1/admin-reports?${params}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
        },
      })
      if (!res.ok) { alert('Download failed. Try again.'); return }

      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `susu-${reportId}-${new Date().toISOString().split('T')[0]}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      alert('Download failed. Check your connection.')
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="px-5 sm:px-8 lg:px-10 py-7 pb-16 animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-ink">Reports</h1>
        <p className="text-ink-2 text-sm mt-1">Export your data as CSV — opens in Excel or Google Sheets</p>
      </div>

      {/* Group filter */}
      <div className="mb-6">
        <label className="block text-sm text-ink-2 mb-1.5">Filter by group (optional)</label>
        <select value={groupId} onChange={e => setGroupId(e.target.value)}
          className="w-full sm:w-96 px-4 py-3 bg-tint border border-line text-ink rounded-[10px] focus:outline-none focus:ring-0 focus:border-blue">
          <option value="">All groups</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {REPORTS.map(({ id, label, desc, color }) => (
          <div key={id} className="border border-line rounded-[10px] p-5 flex flex-col">
            <h3 className="font-bold text-ink">{label}</h3>
            <p className="text-ink-2 text-sm mt-1 flex-1">{desc}</p>
            {id === 'members' && groupId && (
              <p className="text-xs text-ink-3 mt-2 italic">Group filter doesn't apply to this report</p>
            )}
            <button onClick={() => download(id)} disabled={downloading === id}
              className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 bg-tint hover:bg-blue hover:text-ink text-ink font-semibold rounded-[10px] text-sm transition-colors disabled:opacity-50">
              {downloading === id ? '…' : ''}
              Download CSV
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
