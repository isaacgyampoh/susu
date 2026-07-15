'use client'
import { useEffect, useState } from 'react'
import { callFunction, getAdminToken } from '@/lib/supabase'
import type { Announcement, SusuGroup } from '@/types'
import { format } from 'date-fns'
export default function AnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [groups, setGroups]               = useState<SusuGroup[]>([])
  const [loading, setLoading]             = useState(true)
  const [showForm, setShowForm]           = useState(false)
  const [submitting, setSubmitting]       = useState(false)
  const [toast, setToast]                 = useState('')

  const [form, setForm] = useState({
    title: '', content: '', group_id: '', is_global: false, send_sms: false,
  })

  function showToast(m: string) { setToast(m); setTimeout(() => setToast(''), 3000) }
  function setField(k: string, v: unknown) { setForm(p => ({ ...p, [k]: v })) }

  async function load() {
    setLoading(true)
    const token = getAdminToken()
    const [{ data: aData }, { data: gData }] = await Promise.all([
      callFunction<{ announcements: Announcement[] }>('announcements', { token: token! }),
      callFunction<{ groups: SusuGroup[] }>('groups-create', { token: token! }),
    ])
    setAnnouncements(aData?.announcements ?? [])
    setGroups(gData?.groups ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    const token = getAdminToken()
    const { error } = await callFunction('announcements', {
      method: 'POST',
      body: { ...form, group_id: form.group_id || null },
      token: token!,
    })
    setSubmitting(false)
    if (error) { alert(error); return }
    showToast(form.send_sms ? 'Announcement posted and SMS sent to members' : 'Announcement posted')
    setForm({ title: '', content: '', group_id: '', is_global: false, send_sms: false })
    setShowForm(false)
    load()
  }

  return (
    <div className="px-5 sm:px-8 lg:px-10 py-7 pb-16 animate-fade-in">
      {toast && <div className="fixed top-4 right-4 z-50 bg-paper text-ink px-5 py-3 rounded-[10px]  text-sm">{toast}</div>}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">Announcements</h1>
          <p className="text-ink-2 text-sm mt-1">Broadcast messages to members</p>
        </div>
        <button onClick={() => setShowForm(!showForm)}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue text-ink font-semibold rounded-[10px] text-sm hover:brightness-105 transition-colors">
          New Announcement
        </button>
      </div>

      {/* Create form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="border border-line rounded-[10px] p-6 space-y-4 mb-6 animate-slide-up">
          <h2 className="font-bold text-ink">New Announcement</h2>
          <div>
            <label className="block text-sm text-ink-2 mb-1.5">Title *</label>
            <input required value={form.title} onChange={e => setField('title', e.target.value)}
              className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] text-sm focus:outline-none focus:ring-0 focus:border-blue"
              placeholder="e.g. Payment Reminder – Week 3" />
          </div>
          <div>
            <label className="block text-sm text-ink-2 mb-1.5">Message *</label>
            <textarea required value={form.content} onChange={e => setField('content', e.target.value)} rows={4}
              className="w-full px-4 py-3 bg-tint border border-line text-ink rounded-[10px] text-sm focus:outline-none focus:ring-0 focus:border-blue resize-none"
              placeholder="Your announcement message…" />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-ink-2 mb-1.5">Target Group (leave blank for global)</label>
              <select value={form.group_id} onChange={e => setField('group_id', e.target.value)}
                className="w-full px-4 py-3 bg-tint border border-line text-ink text-sm rounded-[10px] focus:outline-none focus:ring-0 focus:border-blue">
                <option value="">All Members (Global)</option>
                {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
          </div>

          <div className="flex gap-5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.is_global} onChange={e => setField('is_global', e.target.checked)} className="w-4 h-4 accent-green" />
              <span className="text-sm text-ink flex items-center gap-1.5">Mark as global</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.send_sms} onChange={e => setField('send_sms', e.target.checked)} className="w-4 h-4 accent-green" />
              <span className="text-sm text-ink flex items-center gap-1.5">Also send via SMS</span>
            </label>
          </div>

          {form.send_sms && (
            <div className="p-3 bg-tint border border-line rounded-[10px] text-ink-2 text-xs">
              SMS will be sent to {form.group_id ? 'all members in the selected group' : 'all active members'}. This will incur Africa's Talking charges.
            </div>
          )}

          <div className="flex gap-3">
            <button type="submit" disabled={submitting}
              className="flex-1 flex items-center justify-center gap-2 py-3 bg-blue text-ink font-bold rounded-[10px] text-sm transition-colors hover:brightness-105 disabled:opacity-50">
              {submitting ? '…' : ''}
              Post Announcement
            </button>
            <button type="button" onClick={() => setShowForm(false)} className="px-5 bg-tint text-ink-2 hover:text-ink rounded-[10px] text-sm transition-colors">Cancel</button>
          </div>
        </form>
      )}

      {/* Announcements list */}
      {loading ? (
        <div className="flex justify-center py-16">'…'</div>
      ) : announcements.length === 0 ? (
        <div className="text-center py-20 text-ink-2">
          No announcements yet
        </div>
      ) : (
        <div className="space-y-4">
          {announcements.map(a => (
            <div key={a.id} className="border border-line rounded-[10px] p-5">
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-bold text-ink">{a.title}</h3>
                <div className="flex items-center gap-2 shrink-0">
                  {a.is_global ? (
                    <span className="flex items-center gap-1 text-xs text-ink bg-tint px-2 py-1 rounded-[10px]">Global</span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-ink bg-blue/10 px-2 py-1 rounded-[10px]">{a.susu_groups?.name}</span>
                  )}
                  <span className="text-ink-2 text-xs">{format(new Date(a.created_at), 'MMM d, yyyy')}</span>
                </div>
              </div>
              <p className="text-ink-2 text-sm leading-relaxed">{a.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
