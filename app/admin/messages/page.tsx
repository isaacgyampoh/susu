'use client'
import { useEffect, useState } from 'react'
import { callFunction, getAdminToken } from '@/lib/supabase'
import { format } from 'date-fns'
type Msg = {
  id: string; subject: string; message: string
  is_read: boolean; reply_text?: string; replied_at?: string; created_at: string
  members?: { member_id: string; full_name: string; phone: string }
}

export default function MessagesPage() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [loading, setLoading]   = useState(true)
  const [selected, setSelected] = useState<Msg | null>(null)
  const [reply, setReply]       = useState('')
  const [sending, setSending]   = useState(false)
  const [toast, setToast]       = useState('')
  const [filter, setFilter]     = useState<'all' | 'unread' | 'replied'>('all')

  function showToast(m: string) { setToast(m); setTimeout(() => setToast(''), 3000) }

  async function load() {
    setLoading(true)
    const token = getAdminToken()
    const { data } = await callFunction<{ messages: Msg[] }>('admin-contacts', { token: token! })
    setMessages(data?.messages ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function sendReply() {
    if (!selected || !reply.trim()) return
    setSending(true)
    const token = getAdminToken()
    const { error } = await callFunction(`admin-contacts?id=${selected.id}`, {
      method: 'PATCH', body: { reply_text: reply }, token: token!,
    })
    setSending(false)
    if (error) { alert(error); return }
    showToast('Reply sent to member')
    setSelected(null); setReply('')
    load()
  }

  const filtered = messages.filter(m => {
    if (filter === 'unread')  return !m.reply_text
    if (filter === 'replied') return !!m.reply_text
    return true
  })

  const unreadCount = messages.filter(m => !m.reply_text).length

  return (
    <div className="px-5 sm:px-8 lg:px-10 py-7 pb-16 animate-fade-in">
      {toast && <div className="fixed top-4 right-4 z-50 bg-paper text-ink px-5 py-3 rounded-[10px]  text-sm">{toast}</div>}

      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-ink">Member Messages</h1>
        <p className="text-ink-2 text-sm mt-1">
          {messages.length} total {unreadCount > 0 && <span className="text-ink">· {unreadCount} awaiting reply</span>}
        </p>
      </div>

      <div className="flex gap-2 mb-6">
        {(['all', 'unread', 'replied'] as const).map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-4 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${filter === s ? 'bg-ink text-white' : 'bg-tint text-ink-2 hover:text-ink'}`}>
            {s} {s === 'unread' && unreadCount > 0 && `(${unreadCount})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-20">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-ink-2">
          No {filter === 'all' ? '' : filter} messages
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(msg => (
            <button key={msg.id} onClick={() => { setSelected(msg); setReply(msg.reply_text ?? '') }}
              className="w-full text-left border border-line rounded-[10px] p-5 hover:border-line transition-colors">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  {msg.reply_text
                    ? '' : ''}
                  <h3 className="font-bold text-ink text-sm">{msg.subject}</h3>
                </div>
                <span className="text-xs text-ink-2 shrink-0">{format(new Date(msg.created_at), 'MMM d, HH:mm')}</span>
              </div>
              <p className="text-ink-2 text-sm line-clamp-2 mb-2">{msg.message}</p>
              <div className="flex items-center justify-between">
                <p className="text-xs text-ink-2">
                  {msg.members?.full_name} · {msg.members?.member_id} · {msg.members?.phone}
                </p>
                {msg.reply_text
                  ? <span className="badge-green">Replied</span>
                  : <span className="badge-gold">Awaiting reply</span>
                }
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Reply modal */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-ink/25 flex items-center justify-center p-4" onClick={() => setSelected(null)}>
          <div className="border border-line rounded-[10px] w-full max-w-lg p-6 space-y-4 animate-slide-up max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}>
            <div>
              <h2 className="font-bold text-ink text-lg">{selected.subject}</h2>
              <p className="text-ink-2 text-xs mt-1">
                From {selected.members?.full_name} ({selected.members?.member_id}) · {selected.members?.phone}
              </p>
              <p className="text-ink-2 text-xs">{format(new Date(selected.created_at), 'MMMM d, yyyy · HH:mm')}</p>
            </div>

            <div className="p-4 bg-tint rounded-[10px]">
              <p className="text-ink text-sm whitespace-pre-wrap">{selected.message}</p>
            </div>

            {selected.reply_text && (
              <div className="p-4 bg-tint border border-line rounded-[10px]">
                <p className="text-xs font-semibold text-ink mb-1">Your reply</p>
                <p className="text-ink text-sm whitespace-pre-wrap">{selected.reply_text}</p>
                {selected.replied_at && <p className="text-xs text-ink-2 mt-2">{format(new Date(selected.replied_at), 'MMM d, yyyy · HH:mm')}</p>}
              </div>
            )}

            <div>
              <label className="block text-sm text-ink-2 mb-1.5">{selected.reply_text ? 'Update reply' : 'Your reply'}</label>
              <textarea className="w-full px-3 py-2 bg-tint border border-line text-ink rounded-[10px] text-sm focus:outline-none focus:ring-0 focus:border-ink resize-none"
                rows={4} value={reply} onChange={e => setReply(e.target.value)} placeholder="Type your reply — the member will see it in their portal…" />
            </div>

            <button onClick={sendReply} disabled={sending || !reply.trim()}
              className="w-full flex items-center justify-center gap-2 py-3 bg-ink text-white font-bold rounded-[10px] hover:brightness-105 transition-colors disabled:opacity-50">
              {sending ? 'Sending…' : 'Send reply'}
              {selected.reply_text ? 'Update Reply' : 'Send Reply'}
            </button>
            <button onClick={() => setSelected(null)} className="w-full text-ink-2 text-sm hover:text-ink py-2">Close</button>
          </div>
        </div>
      )}
    </div>
  )
}
