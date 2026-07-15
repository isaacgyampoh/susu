'use client'

/**
 * RotationRing — the signature element.
 *
 * A Susu is a rotation: N members, each collecting the whole pot on their turn.
 * This shows the whole rotation at a glance — one arc per position, filled as
 * turns are taken, with the member's own slot marked in gold.
 *
 * Nothing in a normal banking app looks like this, because nothing in a normal
 * bank works like this.
 */
export default function RotationRing({
  total,
  position,
  collected = 0,
  size = 200,
  thickness = 9,
  children,
}: {
  total: number          // members in the group
  position: number       // this member's payout slot (1-indexed)
  collected?: number     // how many turns have already been paid out
  size?: number
  thickness?: number
  children?: React.ReactNode
}) {
  const r    = (size - thickness * 2 - 8) / 2
  const cx   = size / 2
  const cy   = size / 2
  const circ = 2 * Math.PI * r

  // Gap between arcs scales down as the group grows, so 30 members still reads
  const gapDeg = total > 20 ? 2 : total > 12 ? 3.5 : 5
  const segDeg = 360 / total - gapDeg
  const segLen = (segDeg / 360) * circ

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {Array.from({ length: total }).map((_, i) => {
          const slot    = i + 1
          const isMine  = slot === position
          const isDone  = slot <= collected
          const isNext  = slot === collected + 1

          const color = isMine ? 'var(--gold)'
                      : isDone ? 'var(--forest)'
                      : isNext ? 'var(--muted)'
                      : 'var(--hairline)'

          return (
            <circle
              key={slot}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={color}
              strokeWidth={isMine ? thickness + 3 : thickness}
              strokeLinecap="round"
              strokeDasharray={`${segLen} ${circ - segLen}`}
              strokeDashoffset={-(circ / total) * i}
              opacity={isMine || isDone ? 1 : isNext ? 0.55 : 0.75}
            />
          )
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6">
        {children}
      </div>
    </div>
  )
}
