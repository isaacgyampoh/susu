'use client'
import { useRouter } from 'next/navigation'
import { cx } from './util'

/* ---------------------------------------------------------------------------
   Table primitives. The point of these is not brevity — it's that the header
   row, the cell padding, the numeric alignment and the horizontal scroll
   behaviour are decided once. Fourteen screens previously each wrote their own
   `px-5 py-3 text-left font-medium`, and they had drifted apart.
   ------------------------------------------------------------------------ */

export function TableWrap({
  children, className, minWidth = 640,
}: { children: React.ReactNode; className?: string; minWidth?: number }) {
  return (
    <div className={cx('overflow-x-auto overscroll-x-contain', className)}>
      <table className="w-full text-base border-collapse" style={{ minWidth }}>
        {children}
      </table>
    </div>
  )
}

export function THead({ children }: { children: React.ReactNode }) {
  return (
    <thead className="border-b border-line">
      <tr>{children}</tr>
    </thead>
  )
}

export function TH({
  children, align = 'left', className, hideBelow,
}: {
  children?: React.ReactNode
  align?: 'left' | 'right' | 'center'
  className?: string
  /** Drop this column below a breakpoint rather than letting the table crush. */
  hideBelow?: 'sm' | 'md' | 'lg'
}) {
  return (
    <th
      scope="col"
      className={cx(
        'px-4 py-2.5 text-2xs font-semibold uppercase tracking-[.06em] text-ink-3 whitespace-nowrap',
        align === 'right' && 'text-right', align === 'center' && 'text-center', align === 'left' && 'text-left',
        hideBelow === 'sm' && 'hidden sm:table-cell',
        hideBelow === 'md' && 'hidden md:table-cell',
        hideBelow === 'lg' && 'hidden lg:table-cell',
        className,
      )}
    >
      {children}
    </th>
  )
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-line-2">{children}</tbody>
}

export function TR({
  children, href, onClick, className,
}: { children: React.ReactNode; href?: string; onClick?: () => void; className?: string }) {
  const router = useRouter()
  const clickable = !!(href || onClick)
  const go = () => { if (href) router.push(href); else onClick?.() }
  return (
    <tr
      className={cx('transition-colors', clickable && 'hover:bg-surface-2 cursor-pointer', className)}
      onClick={clickable ? go : undefined}
      // A row that navigates has to be reachable without a mouse.
      tabIndex={clickable ? 0 : undefined}
      role={clickable ? 'link' : undefined}
      onKeyDown={clickable ? e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() }
      } : undefined}
    >
      {children}
    </tr>
  )
}

export function TD({
  children, align = 'left', num, className, hideBelow, colSpan,
}: {
  children?: React.ReactNode
  align?: 'left' | 'right' | 'center'
  /** Tabular figures + right alignment. Every money and count column wants this. */
  num?: boolean
  className?: string
  hideBelow?: 'sm' | 'md' | 'lg'
  colSpan?: number
}) {
  return (
    <td
      colSpan={colSpan}
      className={cx(
        'px-4 py-3 align-middle text-ink',
        num ? 'text-right tnum font-medium whitespace-nowrap' : '',
        align === 'right' && 'text-right', align === 'center' && 'text-center',
        hideBelow === 'sm' && 'hidden sm:table-cell',
        hideBelow === 'md' && 'hidden md:table-cell',
        hideBelow === 'lg' && 'hidden lg:table-cell',
        className,
      )}
    >
      {children}
    </td>
  )
}

/** Name over identifier — the shape almost every first column takes here. */
export function CellStack({ top, bottom }: { top: React.ReactNode; bottom?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="font-medium text-ink truncate">{top}</p>
      {bottom && <p className="text-xs text-ink-3 truncate mt-0.5">{bottom}</p>}
    </div>
  )
}

/** Bordered container that gives a table its own edge and clips the corners. */
export function TableCard({
  title, count, action, children, className,
}: {
  title?: React.ReactNode
  count?: number
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cx('bg-surface border border-line rounded-lg overflow-hidden', className)}>
      {title && (
        <div className="px-4 py-3 border-b border-line bg-surface-2 flex items-center justify-between gap-3">
          <p className="text-sm font-semibold text-ink">
            {title}
            {count !== undefined && <span className="text-ink-3 font-medium ml-1.5 tnum">{count}</span>}
          </p>
          {action}
        </div>
      )}
      {children}
    </div>
  )
}

export function Pagination({
  page, pageSize, total, onPage,
}: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  const last = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div className="px-4 py-3 border-t border-line flex items-center justify-between gap-3">
      <p className="text-xs text-ink-2 tnum">
        {from}–{to} of {total}
      </p>
      <div className="flex gap-2">
        <button
          type="button" onClick={() => onPage(Math.max(1, page - 1))} disabled={page <= 1}
          className="btn-line btn-sm">Previous</button>
        <button
          type="button" onClick={() => onPage(page + 1)} disabled={page >= last}
          className="btn-line btn-sm">Next</button>
      </div>
    </div>
  )
}
