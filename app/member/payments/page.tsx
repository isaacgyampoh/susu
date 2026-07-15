'use client'
import { useEffect, useState } from 'react'
import { callFunction, getMemberToken } from '@/lib/supabase'
import type { Contribution } from '@/types'
import { format } from 'date-fns'
const n2 = (v: any) => Number(v ?? 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const PRESETS = [7, 14, 30]

export default function Payments() {
  const [rows, setRows]   = useState<Contribution[]>([])
  const [loading, setL]   = useState(true)
  const [filter, setF]    = useState<'all' | 'pending' | 'paid'>('all')
  const [paying, setP]    = useState<string | null>(null)

  const [sheet, setSheet] = useState(false)
  const [days, setDays]   = useState(7)
  const [prev, setPrev]   = useState<any>(null)
  const [loadingPrev, setLP] = useState(false)
  const [bulkBusy, setBB] = useState(false)

  async function load() {
    setL(true)
    const q = filter === 'all' ? 'page=1' : `status=${filter}&page=1`
    const { data } = await callFunction<{ contributions: Contribution[] }>(`contributions-list?${q}`, { token: getMemberToken()! })
    setRows(data?.contributions ?? []); setL(false)
  }
  useEffect(() => { load() }, [filter])

  useEffect(() => {
    if (!sheet) return
    setLP(true)
    callFunction<any>(`payments-bulk?days=${days}`, { token: getMemberToken()! })
      .then(({ data }) => setPrev(data)).finally(() => setLP(false))
  }, [sheet, days])

  async function payOne(c: Contribution) {
    setP(c.id)
    const { data, error } = await callFunction<any>('payments-initialize',
      { method: 'POST', body: { contribution_id: c.id }, token: getMemberToken()! })
    setP(null)
    if (error) return alert(error)
    if (data?.dev_mode) return load()
    if (data?.authorization_url) window.location.href = data.authorization_url
  }

  async function payBulk() {
    setBB(true)
    const { data, error } = await callFunction<any>('payments-bulk',
      { method: 'POST', body: { days }, token: getMemberToken()! })
    setBB(false)
    if (error) return alert(error)
    if (data?.dev_mode) { setSheet(false); return load() }
    if (data?.authorization_url) window.location.href = data.authorization_url
  }

  const unpaid = rows.filter(r => r.status !== 'paid').length

  return (
    <div className="max-w-[440px] mx-auto px-5 py-7 pb-16 animate-fade-in">
      <h1 className="t-h1">Payments</h1>
      <p className="t-meta mt-2">Pay day by day, or clear a stretch in one MoMo payment.</p>

      {unpaid > 0 && (
        <button onClick={() => setSheet(true)}
          className="w-full flex items-baseline justify-between py-5 mt-6 border-y border-line group">
          <div className="text-left">
            <p className="text-[15px] font-bold group-hover:underline underline-offset-4">Pay ahead</p>
            <p className="t-meta mt-0.5">Cover several days at once</p>
          </div>
          <span className="t-label group-hover:text-ink transition-colors">Go</span>
        </button>
      )}

      <div className="flex gap-5 mt-7 border-b border-line">
        {(['all', 'pending', 'paid'] as const).map(f => (
          <button key={f} onClick={() => setF(f)}
            className={`text-[13px] pb-2.5 border-b-2 -mb-px capitalize transition-colors ${
              filter === f ? 'font-bold text-blue border-blue' : 'font-medium text-ink-2 border-transparent'
            }`}>
            {f === 'pending' ? 'Due' : f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-14">'…'</div>
      ) : rows.length === 0 ? (
        <p className="t-meta py-10">{filter === 'paid' ? 'Nothing paid yet.' : "You're all caught up."}</p>
      ) : (
        <table className="w-full mt-1">
          <tbody className="divide-y divide-line">
            {rows.map(c => {
              const paid = c.status === 'paid'
              const late = c.status === 'overdue' || c.is_flagged
              return (
                <tr key={c.id}>
                  <td className="py-3.5 pr-3">
                    <p className="text-[13.5px] font-medium">{c.susu_groups?.name}</p>
                    <p className="t-meta">
                      {format(new Date(c.due_date), 'd MMM yyyy')}
                      {late && <span className="text-red font-semibold"> — late</span>}
                      {Number(c.penalty_due ?? 0) > 0 && <span className="text-red"> +{n2(c.penalty_due)}</span>}
                    </p>
                  </td>
                  <td className="py-3.5 text-right">
                    {paid
                      ? <span className="text-[13px] font-bold tnum">{n2(c.amount)}</span>
                      : <button onClick={() => payOne(c)} disabled={paying === c.id} className="act-gold act-sm">
                          {paying === c.id ? '…' : `Pay ${n2(c.amount)}`}
                        </button>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {/* Pay-ahead sheet */}
      {sheet && (
        <div className="fixed inset-0 z-50 bg-ink/25 flex items-end sm:items-center justify-center" onClick={() => setSheet(false)}>
          <div className="bg-paper w-full sm:max-w-[400px] sm:rounded-[4px] px-6 pt-6 pb-8 max-h-[88vh] overflow-y-auto"
               onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-[22px] font-extrabold tracking-[-.02em]">Pay ahead</h2>
                <p className="t-meta mt-1">One MoMo payment, several days covered.</p>
              </div>
              <button onClick={() => setSheet(false)} aria-label="Close" className="text-ink-3 hover:text-ink transition-colors">
                </button>
            </div>

            <div className="flex gap-5 border-b border-line mb-5">
              {PRESETS.map(d => (
                <button key={d} onClick={() => setDays(d)}
                  className={`text-[13px] pb-2.5 border-b-2 -mb-px transition-colors ${
                    days === d ? 'font-bold text-blue border-blue' : 'font-medium text-ink-2 border-transparent'
                  }`}>
                  {d} days
                </button>
              ))}
            </div>

            <div className="mb-6">
              <div className="flex justify-between t-meta mb-2">
                <span>Or choose exactly</span>
                <span className="font-bold text-ink tnum">{days}</span>
              </div>
              <input type="range" min={1} max={60} value={days} aria-label="Days to pay ahead"
                onChange={e => setDays(parseInt(e.target.value))} className="w-full accent-green" />
            </div>

            {loadingPrev ? (
              <div className="flex justify-center py-10">'…'</div>
            ) : prev?.count > 0 ? (
              <>
                <div className="border-y border-line py-5 mb-5 space-y-2.5">
                  <div className="flex justify-between text-[13px]">
                    <span className="text-ink-2">{prev.count} contribution{prev.count !== 1 && 's'}</span>
                    <span className="tnum font-medium">{n2(prev.subtotal)}</span>
                  </div>
                  {prev.penalties > 0 && (
                    <div className="flex justify-between text-[13px] text-red">
                      <span>Penalties</span><span className="tnum font-medium">{n2(prev.penalties)}</span>
                    </div>
                  )}
                  <div className="t-meta">
                    {prev.from && format(new Date(prev.from), 'd MMM')} – {prev.to && format(new Date(prev.to), 'd MMM yyyy')}
                  </div>
                  <div className="flex items-end justify-between pt-3 border-t border-line">
                    <span className="t-label !text-ink">Total</span>
                    <span className="t-figure"><span className="text-[13px] align-[.4em] mr-0.5 text-ink-2">GHS</span>{n2(prev.total)}</span>
                  </div>
                </div>
                <button onClick={payBulk} disabled={bulkBusy} className="act-gold w-full !h-12">
                  {bulkBusy ? '…' : `Pay GHS ${n2(prev.total)}`}
                </button>
              </>
            ) : (
              <p className="t-meta py-10 text-center">Nothing left to pay.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
