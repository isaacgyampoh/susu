'use client'
import { useEffect, useState } from 'react'
import { callFunction, getMemberToken } from '@/lib/supabase'
import type { Contribution } from '@/types'
import { format } from 'date-fns'
import { Loader2, Zap, Check, Clock, AlertTriangle, X, ArrowUpRight, Calendar } from 'lucide-react'

const ghs = (n: any) => Number(n ?? 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const PRESETS = [{ d: 7, l: '1 week' }, { d: 14, l: '2 weeks' }, { d: 30, l: '1 month' }]

export default function PaymentsPage() {
  const [rows, setRows]         = useState<Contribution[]>([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState<'all' | 'pending' | 'paid'>('all')
  const [payingId, setPayingId] = useState<string | null>(null)

  const [sheet, setSheet]       = useState(false)
  const [days, setDays]         = useState(7)
  const [preview, setPreview]   = useState<any>(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [paying, setPaying]     = useState(false)

  async function load() {
    setLoading(true)
    const token = getMemberToken()
    const q = filter === 'all' ? 'page=1' : `status=${filter}&page=1`
    const { data } = await callFunction<{ contributions: Contribution[] }>(`contributions-list?${q}`, { token: token! })
    setRows(data?.contributions ?? [])
    setLoading(false)
  }
  useEffect(() => { load() }, [filter])

  useEffect(() => {
    if (!sheet) return
    setLoadingPreview(true)
    const token = getMemberToken()
    callFunction<any>(`payments-bulk?days=${days}`, { token: token! })
      .then(({ data }) => setPreview(data))
      .finally(() => setLoadingPreview(false))
  }, [sheet, days])

  async function payOne(c: Contribution) {
    const token = getMemberToken()
    setPayingId(c.id)
    const { data, error } = await callFunction<any>('payments-initialize',
      { method: 'POST', body: { contribution_id: c.id }, token: token! })
    setPayingId(null)
    if (error) { alert(error); return }
    if (data?.dev_mode) { load(); return }
    if (data?.authorization_url) window.location.href = data.authorization_url
  }

  async function payBulk() {
    setPaying(true)
    const token = getMemberToken()
    const { data, error } = await callFunction<any>('payments-bulk',
      { method: 'POST', body: { days }, token: token! })
    setPaying(false)
    if (error) { alert(error); return }
    if (data?.dev_mode) { setSheet(false); load(); return }
    if (data?.authorization_url) window.location.href = data.authorization_url
  }

  const unpaid = rows.filter(r => r.status !== 'paid').length

  return (
    <div className="px-5 pt-6 pb-28 max-w-lg mx-auto animate-fade-in">
      <h1 className="display text-[36px] mb-2">Payments</h1>
      <p className="text-muted text-[15px] mb-7">Pay day by day, or clear a stretch in one go.</p>

      {/* Pay ahead — the MoMo-shaped action, so it leads */}
      {unpaid > 0 && (
        <button onClick={() => setSheet(true)}
          className="w-full sheet p-5 mb-6 flex items-center justify-between text-left transition-transform active:scale-[0.99] group">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-full bg-gold grid place-items-center shrink-0">
              <Zap size={19} className="text-ink" />
            </div>
            <div>
              <p className="font-bold text-[15px]">Pay ahead</p>
              <p className="text-muted text-[13px] mt-0.5">Cover several days in one MoMo payment</p>
            </div>
          </div>
          <ArrowUpRight size={18} className="text-muted group-hover:text-ink transition-colors shrink-0" />
        </button>
      )}

      {/* Filter */}
      <div className="seg mb-5">
        {(['all', 'pending', 'paid'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`seg-item capitalize ${filter === f ? 'seg-item-on' : ''}`}>
            {f === 'pending' ? 'Due' : f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="animate-spin text-forest" size={26} /></div>
      ) : rows.length === 0 ? (
        <div className="sheet p-10 text-center">
          <p className="text-muted text-sm">
            {filter === 'paid' ? 'No payments recorded yet' : "You're all caught up"}
          </p>
        </div>
      ) : (
        <div className="sheet divide-y divide-hairline overflow-hidden">
          {rows.map(c => {
            const paid = c.status === 'paid'
            const late = c.status === 'overdue' || c.is_flagged
            return (
              <div key={c.id} className="flex items-center gap-3.5 p-4">
                <div className={`w-9 h-9 rounded-full grid place-items-center shrink-0 ${
                  paid ? 'bg-emerald-50' : late ? 'bg-red-50' : 'bg-amber-50'
                }`}>
                  {paid ? <Check size={15} className="text-emerald-600" />
                    : late ? <AlertTriangle size={14} className="text-red-600" />
                    : <Clock size={14} className="text-amber-600" />}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-[14px] truncate">{c.susu_groups?.name}</p>
                  <p className="text-[12px] text-muted">
                    {format(new Date(c.due_date), 'd MMM yyyy')}
                    {late && <span className="text-red-600 font-semibold"> · Late</span>}
                    {Number(c.penalty_due ?? 0) > 0 && (
                      <span className="text-red-600"> · +{ghs(c.penalty_due)} penalty</span>
                    )}
                  </p>
                </div>

                {paid ? (
                  <p className="font-bold text-[14px] tnum text-emerald-700 shrink-0">+{ghs(c.amount)}</p>
                ) : (
                  <button onClick={() => payOne(c)} disabled={payingId === c.id}
                    className="pill-gold !px-4 !py-2 !text-[13px] shrink-0">
                    {payingId === c.id ? <Loader2 size={13} className="animate-spin" /> : `Pay ${ghs(c.amount)}`}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Pay-ahead sheet ── */}
      {sheet && (
        <div className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-sm flex items-end sm:items-center justify-center"
             onClick={() => setSheet(false)}>
          <div className="bg-white w-full sm:max-w-md rounded-t-[32px] sm:rounded-[32px] p-6 pb-8 animate-slide-up max-h-[90vh] overflow-y-auto"
               onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-hairline rounded-full mx-auto mb-6 sm:hidden" />

            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="display text-[26px]">Pay ahead</h2>
                <p className="text-muted text-[13px] mt-1">One MoMo payment, several days covered</p>
              </div>
              <button onClick={() => setSheet(false)} aria-label="Close"
                className="w-8 h-8 rounded-full bg-canvas grid place-items-center text-muted shrink-0">
                <X size={16} />
              </button>
            </div>

            <div className="seg mb-5">
              {PRESETS.map(({ d, l }) => (
                <button key={d} onClick={() => setDays(d)}
                  className={`seg-item ${days === d ? 'seg-item-on' : ''}`}>{l}</button>
              ))}
            </div>

            <div className="mb-6">
              <div className="flex justify-between text-[13px] mb-2.5">
                <span className="text-muted">Or pick exactly</span>
                <span className="font-bold tnum">{days} day{days !== 1 && 's'}</span>
              </div>
              <input type="range" min={1} max={60} value={days} aria-label="Days to pay ahead"
                onChange={e => setDays(parseInt(e.target.value))}
                className="w-full accent-forest" />
            </div>

            {loadingPreview ? (
              <div className="flex justify-center py-10"><Loader2 className="animate-spin text-forest" size={24} /></div>
            ) : preview?.count > 0 ? (
              <>
                <div className="bg-canvas rounded-3xl p-5 mb-5">
                  <div className="flex items-center gap-2 text-[12px] text-muted mb-3">
                    <Calendar size={13} />
                    {preview.from && format(new Date(preview.from), 'd MMM')} – {preview.to && format(new Date(preview.to), 'd MMM yyyy')}
                  </div>
                  <div className="space-y-2 text-[14px]">
                    <div className="flex justify-between">
                      <span className="text-muted">{preview.count} contribution{preview.count !== 1 && 's'}</span>
                      <span className="tnum font-medium">GHS {ghs(preview.subtotal)}</span>
                    </div>
                    {preview.penalties > 0 && (
                      <div className="flex justify-between text-red-600">
                        <span>Late penalties</span>
                        <span className="tnum font-medium">GHS {ghs(preview.penalties)}</span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-end justify-between pt-4 mt-4 border-t border-hairline">
                    <span className="font-semibold text-[14px]">Total</span>
                    <span className="display text-[28px] tnum">
                      <span className="text-[15px] font-bold align-top mr-0.5">GHS</span>
                      {ghs(preview.total)}
                    </span>
                  </div>
                </div>

                <button onClick={payBulk} disabled={paying} className="pill-gold w-full !py-4 text-[15px]">
                  {paying ? <Loader2 size={18} className="animate-spin" />
                    : <>Pay GHS {ghs(preview.total)} <ArrowUpRight size={17} /></>}
                </button>
              </>
            ) : (
              <div className="text-center py-10">
                <div className="w-12 h-12 rounded-full bg-emerald-50 grid place-items-center mx-auto mb-3">
                  <Check size={20} className="text-emerald-600" />
                </div>
                <p className="text-muted text-sm">Nothing left to pay — you're ahead.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
