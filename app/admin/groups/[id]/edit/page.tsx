'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { callFunction, getAdminToken } from '@/lib/supabase'
import type { SusuGroup } from '@/types'

const n0 = (v: any) => Number(v ?? 0).toLocaleString('en-GH', { maximumFractionDigits: 0 })

export default function EditGroup() {
  const { id }  = useParams<{ id: string }>()
  const router  = useRouter()
  const [g, setG]         = useState<SusuGroup | null>(null)
  const [loading, setL]   = useState(true)
  const [busy, setBusy]   = useState(false)
  const [err, setErr]     = useState('')
  const [note, setNote]   = useState('')
  const [confirm, setConfirm] = useState(false)
  const [typed, setTyped] = useState('')

  const [f, setF] = useState<Record<string, string>>({})
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }))

  useEffect(() => {
    callFunction<{ group: SusuGroup }>(`groups-create?id=${id}`, { token: getAdminToken()! })
      .then(({ data }) => {
        const x = data?.group
        if (!x) { setErr('Group not found'); setL(false); return }
        setG(x)
        setF({
          name: x.name ?? '',
          description: x.description ?? '',
          contribution_amount: String(x.contribution_amount ?? ''),
          contribution_frequency: x.contribution_frequency ?? 'daily',
          cycle_days: String(x.cycle_days ?? ''),
          max_members: String(x.max_members ?? ''),
          registration_fee: String(x.registration_fee ?? ''),
          cashout_amount: String(x.cashout_amount ?? ''),
          payment_deadline: (x.payment_deadline ?? '18:00').slice(0, 5),
          penalty_per_late_day: String(x.penalty_per_late_day ?? ''),
          rules: (x as any).rules ?? '',
          admin_notes: (x as any).admin_notes ?? '',
        })
        setL(false)
      })
  }, [id])

  const running = g?.status === 'active'

  async function save(e: React.FormEvent, force = false) {
    e.preventDefault()
    setBusy(true); setErr(''); setNote('')
    const { error } = await callFunction(`groups-create?id=${id}`, {
      method: 'PATCH', body: { ...f, force }, token: getAdminToken()!,
    })
    setBusy(false)
    if (error) { setErr(error); return }
    setNote('Saved')
    setTimeout(() => router.push('/admin/groups'), 900)
  }

  async function remove() {
    setBusy(true); setErr('')
    const { error } = await callFunction(`groups-create?id=${id}`, {
      method: 'DELETE', token: getAdminToken()!,
    })
    setBusy(false)
    if (error) { setErr(error); setConfirm(false); return }
    router.push('/admin/groups')
  }

  if (loading) return <div className="px-5 sm:px-8 py-10 text-[13px] text-ink-3">Loading…</div>
  if (!g)      return <div className="px-5 sm:px-8 py-10 text-[13px] text-ink-3">{err || 'Group not found'}</div>

  return (
    <div className="px-5 sm:px-8 py-7 pb-16 max-w-[640px] animate-fade-in">
      <Link href="/admin/groups" className="text-[12.5px] font-medium text-ink-2 hover:text-ink transition-colors">
        Back to groups
      </Link>

      <h1 className="t-title mt-4">Edit group</h1>
      <p className="t-meta mt-1.5">{g.name} · {g.current_members}/{g.max_members} members · {g.status}</p>

      {running && (
        <div className="mt-5 p-3.5 rounded-lg border border-line bg-bg">
          <p className="text-[12.5px] text-ink-2">
            This group is running. You can change the name, description, rules, notes,
            deadline, penalty and cashout. Changing the daily amount, cycle length,
            frequency or size would move members&apos; collection dates, so those are
            blocked unless you force it.
          </p>
        </div>
      )}

      {err  && <p className="mt-5 text-[12.5px] text-red bg-red/10 border border-red/20 rounded-lg px-3 py-2.5">{err}</p>}
      {note && <p className="mt-5 text-[12.5px] text-ink bg-bg border border-line rounded-lg px-3 py-2.5">{note}</p>}

      <form onSubmit={e => save(e)} className="mt-6 space-y-5">
        <div>
          <label className="in-lbl">Group name</label>
          <input className="in" required value={f.name} onChange={e => set('name', e.target.value)} />
        </div>
        <div>
          <label className="in-lbl">Description <span className="font-normal text-ink-3">— shown on the website</span></label>
          <input className="in" value={f.description} onChange={e => set('description', e.target.value)} />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="in-lbl">Contribution (GHS)</label>
            <input className="in tnum" type="number" step="0.01" value={f.contribution_amount}
              onChange={e => set('contribution_amount', e.target.value)} disabled={running} />
          </div>
          <div>
            <label className="in-lbl">Frequency</label>
            <select className="in" value={f.contribution_frequency}
              onChange={e => set('contribution_frequency', e.target.value)} disabled={running}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
          <div>
            <label className="in-lbl">Members</label>
            <input className="in tnum" type="number" value={f.max_members}
              onChange={e => set('max_members', e.target.value)} disabled={running} />
          </div>
          <div>
            <label className="in-lbl">Cycle days</label>
            <input className="in tnum" type="number" value={f.cycle_days}
              onChange={e => set('cycle_days', e.target.value)} disabled={running} />
          </div>
          <div>
            <label className="in-lbl">Deadline</label>
            <input className="in" type="time" value={f.payment_deadline}
              onChange={e => set('payment_deadline', e.target.value)} />
          </div>
          <div>
            <label className="in-lbl">Late penalty per day (GHS)</label>
            <input className="in tnum" type="number" step="0.01" value={f.penalty_per_late_day}
              onChange={e => set('penalty_per_late_day', e.target.value)} />
          </div>
        </div>

        <div className="p-4 rounded-lg border border-line bg-bg">
          <label className="in-lbl">Member cashout (GHS)</label>
          <input className="in tnum" type="number" step="0.01" value={f.cashout_amount}
            onChange={e => set('cashout_amount', e.target.value)} />
          <p className="text-[11.5px] text-ink-3 mt-2">
            Exactly what the member receives and sees. Your commission is separate.
          </p>
        </div>

        <div>
          <label className="in-lbl">Registration fee (GHS) <span className="font-normal text-ink-3">— your commission</span></label>
          <input className="in tnum" type="number" step="0.01" value={f.registration_fee}
            onChange={e => set('registration_fee', e.target.value)} />
          <p className="text-[11.5px] text-ink-3 mt-1.5">
            Charged once at sign-up. Never added to the member&apos;s cashout.
          </p>
        </div>

        <div>
          <label className="in-lbl">Rules <span className="font-normal text-ink-3">— optional</span></label>
          <textarea className="in-area" rows={2} value={f.rules} onChange={e => set('rules', e.target.value)} />
        </div>
        <div>
          <label className="in-lbl">Admin notes <span className="font-normal text-ink-3">— private</span></label>
          <textarea className="in-area" rows={2} value={f.admin_notes} onChange={e => set('admin_notes', e.target.value)} />
        </div>

        <div className="flex gap-2 pt-2">
          <button type="submit" disabled={busy} className="btn-dark">{busy ? 'Saving…' : 'Save changes'}</button>
          <Link href="/admin/groups" className="btn-line">Cancel</Link>
        </div>
      </form>

      {/* Delete — guarded server-side, but say what will happen first */}
      <div className="mt-12 pt-6 border-t border-line">
        <h2 className="t-h2">Delete this group</h2>
        <p className="t-meta mt-1.5 max-w-[460px]">
          Only possible while a group has no members and no paid contributions.
          Once money has gone in, deleting it would erase that record — mark it
          completed instead.
        </p>

        {!confirm ? (
          <button onClick={() => setConfirm(true)} className="btn-line btn-sm mt-4 !text-red !border-red/30">
            Delete group
          </button>
        ) : (
          <div className="mt-4 p-4 rounded-lg border border-red/30 bg-red/5 max-w-[460px]">
            <p className="text-[13px] font-medium">Type the group name to confirm</p>
            <p className="text-[12px] text-ink-2 mt-1">{g.name}</p>
            <input className="in mt-3" value={typed} onChange={e => setTyped(e.target.value)} placeholder={g.name} />
            <div className="flex gap-2 mt-3">
              <button onClick={remove} disabled={busy || typed !== g.name} className="btn-red btn-sm">
                {busy ? 'Deleting…' : 'Delete permanently'}
              </button>
              <button onClick={() => { setConfirm(false); setTyped('') }} className="btn-line btn-sm">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
