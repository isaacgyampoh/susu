'use client'
import { useEffect, useRef, useState, useCallback } from 'react'

/**
 * Edge-swipe drawer.
 *
 * On a phone the sidebar should answer to the thumb, not to a "Menu" word.
 * Drag from the left edge and the panel tracks your finger; let go past a
 * threshold (or with enough velocity) and it settles open. Drag it back, tap
 * the scrim, or navigate — it closes.
 *
 * Pointer Events cover touch, pen and mouse in one path.
 */
export function useSwipeDrawer(width = 264) {
  const [open, setOpen] = useState(false)
  const [drag, setDrag] = useState<number | null>(null)  // px revealed while dragging

  const start   = useRef<{ x: number; y: number; t: number } | null>(null)
  const axis    = useRef<'x' | 'y' | null>(null)
  const openRef = useRef(open)
  openRef.current = open

  useEffect(() => {
    const EDGE = 24 // how close to the edge a drag must begin to count

    function down(e: PointerEvent) {
      if (e.pointerType === 'mouse') return
      const fromEdge = e.clientX <= EDGE
      if (!fromEdge && !openRef.current) return
      start.current = { x: e.clientX, y: e.clientY, t: Date.now() }
      axis.current  = null
    }

    function move(e: PointerEvent) {
      if (!start.current) return
      const dx = e.clientX - start.current.x
      const dy = e.clientY - start.current.y

      // Decide intent once: horizontal drags are ours, vertical belong to scroll
      if (!axis.current) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
        axis.current = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
        if (axis.current === 'y') { start.current = null; return }
      }

      const base = openRef.current ? width : 0
      setDrag(Math.max(0, Math.min(width, base + dx)))
    }

    function up() {
      if (!start.current || axis.current !== 'x') { start.current = null; setDrag(null); return }
      const elapsed  = Date.now() - start.current.t
      const revealed = drag ?? (openRef.current ? width : 0)
      const velocity = revealed / Math.max(elapsed, 1)

      // Settle on distance, or on a decisive flick
      setOpen(velocity > 0.5 ? revealed > width * 0.25 : revealed > width * 0.5)
      setDrag(null)
      start.current = null
      axis.current  = null
    }

    window.addEventListener('pointerdown', down,   { passive: true })
    window.addEventListener('pointermove', move,   { passive: true })
    window.addEventListener('pointerup',   up,     { passive: true })
    window.addEventListener('pointercancel', up,   { passive: true })
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [width, drag])

  // Don't scroll the page behind an open drawer
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  const close = useCallback(() => setOpen(false), [])
  const shown = drag ?? (open ? width : 0)

  return { open, setOpen, close, shown, dragging: drag !== null }
}
