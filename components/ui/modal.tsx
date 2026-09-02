'use client'
import { useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cx } from './util'

/* ---------------------------------------------------------------------------
   One modal, used by everything.

   What the hand-rolled overlays this replaces were all missing:
     - focus moves into the dialog and cannot leave it while it is open
     - focus returns to whatever opened it on close
     - Escape closes
     - the page behind does not scroll, and does not jump when the
       scrollbar disappears
     - role/aria-modal/aria-labelledby, so it is announced as a dialog

   On phones it rises from the bottom edge; from `sm` up it is centred. That is
   not decoration: a sheet anchored to the bottom is reachable by the thumb,
   which matters because most of these dialogs are the last step before money
   moves.
   ------------------------------------------------------------------------ */

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'

let openCount = 0

function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    openCount += 1
    if (openCount === 1) {
      const gap = window.innerWidth - document.documentElement.clientWidth
      document.body.dataset.prevOverflow = document.body.style.overflow
      document.body.dataset.prevPad = document.body.style.paddingRight
      document.body.style.overflow = 'hidden'
      // Compensating for the vanished scrollbar stops the whole page shifting
      // left the instant a dialog opens.
      if (gap > 0) document.body.style.paddingRight = `${gap}px`
    }
    return () => {
      openCount -= 1
      if (openCount === 0) {
        document.body.style.overflow = document.body.dataset.prevOverflow ?? ''
        document.body.style.paddingRight = document.body.dataset.prevPad ?? ''
        delete document.body.dataset.prevOverflow
        delete document.body.dataset.prevPad
      }
    }
  }, [active])
}

export type ModalProps = {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  description?: React.ReactNode
  /** Pinned to the bottom of the dialog, outside the scroll area. */
  footer?: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
  /** Set while a request is in flight: blocks Escape and backdrop dismissal. */
  busy?: boolean
  /** Suppresses the corner close button (a decision that must be made explicitly). */
  hideClose?: boolean
  tone?: 'default' | 'danger'
  children?: React.ReactNode
}

const SIZE = { sm: 'sm:max-w-sm', md: 'sm:max-w-md', lg: 'sm:max-w-lg' }

export function Modal({
  open, onClose, title, description, footer, size = 'md',
  busy, hideClose, tone = 'default', children,
}: ModalProps) {
  const panel = useRef<HTMLDivElement>(null)
  const restoreTo = useRef<HTMLElement | null>(null)

  const dismiss = useCallback(() => { if (!busy) onClose() }, [busy, onClose])

  // Remember the opener, then move focus in.
  useEffect(() => {
    if (!open) return
    restoreTo.current = document.activeElement as HTMLElement | null
    const t = requestAnimationFrame(() => {
      const el = panel.current
      if (!el) return
      const first = el.querySelector<HTMLElement>('[data-autofocus]')
        ?? el.querySelector<HTMLElement>(FOCUSABLE)
      ;(first ?? el).focus({ preventScroll: true })
    })
    return () => {
      cancelAnimationFrame(t)
      restoreTo.current?.focus?.({ preventScroll: true })
    }
  }, [open])

  // Escape to close, Tab wrapped inside the panel.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); dismiss(); return }
      if (e.key !== 'Tab') return
      const el = panel.current
      if (!el) return
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter(n => n.offsetParent !== null || n === document.activeElement)
      if (!items.length) { e.preventDefault(); return }
      const first = items[0], last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, dismiss])

  useScrollLock(open)

  if (!open || typeof document === 'undefined') return null

  const labelled = title ? 'modal-title' : undefined

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4">
      <div
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px] animate-fade-in"
        onClick={dismiss}
        aria-hidden="true"
      />
      <div
        ref={panel}
        role="dialog" aria-modal="true"
        aria-labelledby={labelled}
        tabIndex={-1}
        className={cx(
          'relative w-full bg-surface shadow-pop outline-none',
          'rounded-t-2xl sm:rounded-lg',
          'max-h-[92dvh] sm:max-h-[85dvh] flex flex-col',
          'animate-sheet-up sm:animate-pop-in',
          SIZE[size],
        )}
      >
        {/* Grab handle: tells a thumb this panel came from the bottom edge. */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center shrink-0" aria-hidden="true">
          <span className="w-9 h-1 rounded-full bg-surface-3" />
        </div>

        {(title || !hideClose) && (
          <div className="flex items-start gap-3 px-5 sm:px-6 pt-4 sm:pt-6 pb-1 shrink-0">
            <div className="min-w-0 flex-1">
              {title && (
                <h2 id={labelled}
                  className={cx('text-lg font-semibold', tone === 'danger' ? 'text-danger' : 'text-ink')}>
                  {title}
                </h2>
              )}
              {description && (
                <p className="text-sm text-ink-2 mt-1.5 leading-relaxed">{description}</p>
              )}
            </div>
            {!hideClose && (
              <button
                type="button" onClick={dismiss} disabled={busy} aria-label="Close"
                className="-mr-1.5 -mt-1 w-9 h-9 grid place-items-center rounded-md text-ink-3
                           hover:text-ink hover:bg-surface-2 transition-colors shrink-0
                           disabled:opacity-40 disabled:pointer-events-none"
              >
                <X size={18} strokeWidth={2.2} aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        <div className="px-5 sm:px-6 py-4 overflow-y-auto overscroll-contain flex-1 min-h-0">
          {children}
        </div>

        {footer && (
          <div className="px-5 sm:px-6 pt-3 pb-5 sm:pb-6 border-t border-line shrink-0
                          pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-6">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** Standard footer: cancel left, the real action right, full-width on phones. */
export function ModalActions({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col-reverse sm:flex-row sm:justify-end gap-2', className)}>
      {children}
    </div>
  )
}
