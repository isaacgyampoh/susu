'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { callFunction, getAdminToken } from '@/lib/supabase'
import type { SusuGroup } from '@/types'
import { ghs as n0 } from '@/lib/money'


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
          start_date: (x as any).start_date ?? '',
          penalty_per_late_day: String(x.penalty_per_late_day ?? ''),
          rules: (x as any).rules ?? '',
          admin_notes: (x as any).admin_notes ?? '',
        })
        setL(false)
      })
  }, [id])

  const running = g?.status === 'active'
  const [delText, setDelText]   = useState('')
  const [deleting, setDeleting] = useState(false)

  async function deleteGroup() {
    setDeleting(true)
    const { data, error } = await callFunction<{ message: string }>(`groups-create?id=${id}`, {
      method: 'DELETE', token: getAdminToken()!,
    })
    setDeleting(false)
    if (error) { alert(error); return }
    alert(data?.message ?? 'Group deleted')
    router.push('/admin/groups')
  }

  /* One turn: everyone pays for its length, one member collects at the end. */
  const members    = Number(f.max_members) || 0
  const perTurn    = (Number(f.contribution_amount) || 0) * members * (Number(f.cycle_days) || 0)
  const turnMargin = perTurn - (Number(f.cashout_amount) || 0)
  const commission = (Number(f.registration_fee) || 0) * members

  async function save(e: React.FormEvent, force = false) {
    e.preventDefault()
    setBusy(true); setErr(''); setNote('')
    const { error } = await callFunction(`groups-create?id=${id}`, {
      method: 'PATCH', body: { ...f, start_date: running ? undefined : (f.start_date || null), force }, token: getAdminToken()!,
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
    <div className="px-5 sm:px-8 lg:px-10 py-7 pb-16 animate-fade-in">
      <Link href="/admin/groups" className="text-[12.5px] font-medium text-ink-2 hover:text-ink transition-colors">
        Back to groups
      </Link>

      <header className="mt-4 mb-7 flex items-start justify-between gap-6 flex-wrap">
        <div>
          <h1 className="t-title">Edit group</h1>
          <p className="t-meta mt-1.5">{g.name} · {g.current_members}/{g.max_members} members · {g.status}</p>
        </div>
        <span className={g.status === 'active' ? 'pill-on' : 'pill-off'}>{g.status}</span>
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
      <div className="min-w-0">

      {running && (
        <div className="p-3.5 rounded-lg border border-line bg-bg mb-5">
          <p className="text-[12.5px] text-ink-2">
            This group is running. You can change the name, description, rules, notes,
            deadline, penalty and cashout. Changing the daily amount, cycle length,
            frequency or size would move members&apos; collection dates, so those are
            blocked unless you force it.
          </p>
        </div>
      )}

      {err  && <p className="mb-5 text-[12.5px] text-red bg-red/10 border border-red/20 rounded-lg px-3 py-2.5">{err}</p>}
      {note && <p className="mb-5 text-[12.5px] text-ink bg-bg border border-line rounded-lg px-3 py-2.5">{note}</p>}

      <form onSubmit={e => save(e)} className="card p-5 sm:p-6 space-y-5">
        <div>
          <label className="in-lbl">Group name</label>
          <input className="in" required value={f.name} onChange={e => set('name', e.target.value)} />
        </div>
        <div>
          <label className="in-lbl">Description <span className="font-normal text-ink-3">— shown on the website</span></label>
          <input className="in" value={f.description} onChange={e => set('description', e.target.value)} />
        </div>

        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
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
            <label className="in-lbl">Start date {running && <span className="font-normal text-ink-3">— locked while running</span>}</label>
            {running ? (
              <>
                <input className="in opacity-60" type="date" value={f.start_date} disabled />
                <p className="text-[11.5px] text-ink-3 mt-1.5">
                  This group is running — use <strong>change date</strong> on the Groups page so the schedule is rebuilt correctly.
                </p>
              </>
            ) : (
              <>
                <input className="in" type="date" value={f.start_date}
                  onChange={e => set('start_date', e.target.value)} />
                <p className="text-[11.5px] text-ink-3 mt-1.5">
                  The day this group actually began — past dates welcome for groups from your books.
                  The schedule itself is generated when you activate; this date is pre-filled there.
                </p>
              </>
            )}
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

      {/* Danger zone */}
      <div className="border border-red/40 rounded-xl p-5 mt-8">
        <h2 className="font-bold text-red text-sm">Danger zone</h2>
        <p className="t-body text-xs mt-1.5 leading-relaxed">
          Delete this group and its schedule permanently. Members in it lose these slots (their accounts and
          other groups are untouched); old applications are kept but detached. Groups where money has already
          been paid in or out <strong>cannot</strong> be deleted — that history must survive.
        </p>
        <div className="flex flex-col sm:flex-row gap-2 mt-3">
          <input value={delText} onChange={e => setDelText(e.target.value)}
            placeholder={`Type ${g?.name ?? 'the group name'} to confirm`}
            className="in flex-1" />
          <button type="button" onClick={deleteGroup}
            disabled={deleting || !g || delText.trim() !== g.name}
            className="px-4 py-2.5 border border-red/50 text-red text-sm font-semibold rounded-[10px] hover:bg-red hover:text-white transition-colors disabled:opacity-40 whitespace-nowrap">
            {deleting ? 'Deleting…' : 'Delete this group'}
          </button>
        </div>
      </div>
      </div>

      {/* Aside: what the numbers being typed actually mean, and the danger zone.
          This is what the extra width is for — not wider inputs. */}
      <aside className="space-y-4 lg:sticky lg:top-6">
        <div className="card p-5">
          <p className="t-label mb-4">What members see</p>
          <table className="w-full">
            <tbody className="divide-y divide-line border-y border-line">
              <tr>
                <td className="py-2.5 text-[12.5px] text-ink-2">They pay</td>
                <td className="py-2.5 text-right text-[13px] font-medium tnum">
                  GHS {n0(f.contribution_amount)} <span className="text-ink-3 font-normal">{f.contribution_frequency}</span>
                </td>
              </tr>
              <tr>
                <td className="py-2.5 text-[12.5px] text-ink-2">They collect</td>
                <td className="py-2.5 text-right text-[15px] font-semibold tnum">GHS {n0(f.cashout_amount)}</td>
              </tr>
              <tr>
                <td className="py-2.5 text-[12.5px] text-ink-2">Deadline</td>
                <td className="py-2.5 text-right text-[13px] font-medium tnum">{f.payment_deadline || '18:00'}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card p-5">
          <p className="t-label mb-4">Yours</p>
          <table className="w-full">
            <tbody className="divide-y divide-line border-y border-line">
              <tr>
                <td className="py-2.5 text-[12.5px] text-ink-2">
                  Margin per turn
                  <span className="block text-[11px] text-ink-3 tnum">
                    {n0(perTurn)} collected − {n0(f.cashout_amount)} paid
                  </span>
                </td>
                <td className={`py-2.5 text-right text-[13px] font-medium tnum align-top ${turnMargin < 0 ? 'text-red' : ''}`}>
                  GHS {n0(turnMargin)}
                </td>
              </tr>
              <tr>
                <td className="py-2.5 text-[12.5px] text-ink-2">
                  Over {members} turns
                  <span className="block text-[11px] text-ink-3">full rotation</span>
                </td>
                <td className="py-2.5 text-right text-[13px] font-medium tnum align-top">GHS {n0(turnMargin * members)}</td>
              </tr>
              <tr>
                <td className="py-2.5 text-[12.5px] text-ink-2">
                  Commission
                  <span className="block text-[11px] text-ink-3 tnum">{n0(f.registration_fee)} × {members}</span>
                </td>
                <td className="py-2.5 text-right text-[13px] font-medium tnum align-top">GHS {n0(commission)}</td>
              </tr>
              <tr>
                <td className="py-2.5 text-[12.5px] font-medium">Total to you</td>
                <td className="py-2.5 text-right text-[15px] font-semibold tnum">GHS {n0(turnMargin * members + commission)}</td>
              </tr>
            </tbody>
          </table>
          {turnMargin < 0 && (
            <p className="text-[12px] text-red mt-3">
              The cashout exceeds what a turn collects. You lose money on every turn.
            </p>
          )}
          <p className="text-[11.5px] text-ink-3 mt-3">Never shown to members.</p>
        </div>

        <div className="card p-5 border-red/25">
          <p className="t-label !text-red mb-2">Delete this group</p>
          <p className="text-[12px] text-ink-2 leading-relaxed">
            Only possible while a group has no members and no paid contributions.
            Once money has gone in, deleting would erase that record — mark it
            completed instead.
          </p>

          {!confirm ? (
            <button onClick={() => setConfirm(true)} className="btn-line btn-sm mt-4 w-full !text-red !border-red/30">
              Delete group
            </button>
          ) : (
            <div className="mt-4">
              <p className="text-[12.5px] font-medium">Type the name to confirm</p>
              <p className="text-[11.5px] text-ink-2 mt-0.5 mb-2">{g.name}</p>
              <input className="in" value={typed} onChange={e => setTyped(e.target.value)} placeholder={g.name} />
              <div className="flex gap-2 mt-3">
                <button onClick={remove} disabled={busy || typed !== g.name} className="btn-red btn-sm flex-1">
                  {busy ? 'Deleting…' : 'Delete'}
                </button>
                <button onClick={() => { setConfirm(false); setTyped('') }} className="btn-line btn-sm">Cancel</button>
              </div>
            </div>
          )}
        </div>
      </aside>
      </div>
    </div>
  )
}
