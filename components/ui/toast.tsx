'use client'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react'
import { cx } from './util'

/* ---------------------------------------------------------------------------
   Toasts replace `alert()` for everything that merely *reports* — "12 invites
   sent", "could not reach the server". alert() blocks the whole page, cannot
   be styled, cannot show two things at once, and on iOS standalone PWAs it
   renders with the origin URL above it, which looks like a phishing dialog in
   an app whose entire job is handling money.

   Anything that needs a *decision* goes to useConfirm() instead.
   ------------------------------------------------------------------------ */

export type ToastTone = 'success' | 'error' | 'warning' | 'info'
type Toast = { id: number; tone: ToastTone; title: string; body?: string; duration: number }

type ToastInput = string | { title: string; body?: string; duration?: number }

type Api = {
  success: (t: ToastInput) => void
  error:   (t: ToastInput) => void
  warning: (t: ToastInput) => void
  info:    (t: ToastInput) => void
  dismiss: (id: number) => void
}

const Ctx = createContext<Api | null>(null)

/** Available anywhere under <Providers>. */
export function useToast(): Api {
  const api = useContext(Ctx)
  if (!api) throw new Error('useToast must be used inside <Providers>')
  return api
}

const ICON = { success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info }
const TONE: Record<ToastTone, string> = {
  success: 'text-success',
  error:   'text-danger',
  warning: 'text-warning',
  info:    'text-info',
}

let seq = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    setItems(list => list.filter(t => t.id !== id))
    const t = timers.current.get(id)
    if (t) { clearTimeout(t); timers.current.delete(id) }
  }, [])

  const push = useCallback((tone: ToastTone, input: ToastInput) => {
    const o = typeof input === 'string' ? { title: input } : input
    // Errors get longer on screen — they usually carry something to act on.
    const duration = o.duration ?? (tone === 'error' ? 8000 : 4500)
    const id = ++seq
    setItems(list => [...list.slice(-3), { id, tone, title: o.title, body: o.body, duration }])
    timers.current.set(id, setTimeout(() => dismiss(id), duration))
  }, [dismiss])

  const api = useMemo<Api>(() => ({
    success: t => push('success', t),
    error:   t => push('error', t),
    warning: t => push('warning', t),
    info:    t => push('info', t),
    dismiss,
  }), [push, dismiss])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => { timers.current.forEach(clearTimeout) }, [])

  return (
    <Ctx.Provider value={api}>
      {children}
      <ToastViewport items={items} onDismiss={dismiss} />
    </Ctx.Provider>
  )
}

function ToastViewport({ items, onDismiss }: { items: Toast[]; onDismiss: (id: number) => void }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted || typeof document === 'undefined') return null

  return createPortal(
    <div
      // Above modals: a failed save inside a dialog must still be readable.
      className="fixed z-[200] inset-x-0 top-0 sm:inset-x-auto sm:right-4 sm:top-4
                 flex flex-col items-center sm:items-end gap-2 p-3 sm:p-0 pointer-events-none
                 pt-[max(0.75rem,env(safe-area-inset-top))]"
      role="region" aria-label="Notifications"
    >
      {items.map(t => {
        const Icon = ICON[t.tone]
        return (
          <div
            key={t.id}
            role="status"
            aria-live={t.tone === 'error' ? 'assertive' : 'polite'}
            className="pointer-events-auto w-full sm:w-[360px] max-w-full
                       bg-surface border border-line rounded-md shadow-md
                       flex items-start gap-3 p-3.5 animate-toast-in"
          >
            <Icon size={17} strokeWidth={2.2} aria-hidden="true"
              className={cx('shrink-0 mt-px', TONE[t.tone])} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink leading-snug">{t.title}</p>
              {t.body && <p className="text-xs text-ink-2 mt-1 leading-relaxed break-words">{t.body}</p>}
            </div>
            <button
              type="button" onClick={() => onDismiss(t.id)} aria-label="Dismiss"
              className="shrink-0 -mr-1 -mt-1 w-7 h-7 grid place-items-center rounded-xs
                         text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors"
            >
              <X size={14} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
