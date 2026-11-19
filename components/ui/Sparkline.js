/**
 * SVG sparkline (Paper 28 Sensors): 310×48, 2px round stroke, 4px vertical
 * inset. Offline/empty draws a flat faint line.
 */
const STROKE = {
  alert: 'var(--alert)',
  good: 'var(--good)',
  cyan: 'var(--cyan)',
  warn: 'var(--warn)',
  pink: 'var(--pink)',
  faint: 'var(--faint)',
}

export function sparkPath(values, width = 310, height = 48, inset = 4) {
  const pts = (values || []).filter((n) => Number.isFinite(n))
  if (pts.length < 2) return `M0 ${height / 2} L${width} ${height / 2}`
  const min = Math.min(...pts)
  const max = Math.max(...pts)
  const span = max - min || 1
  const step = width / (pts.length - 1)
  return pts
    .map((v, i) => {
      const x = (i * step).toFixed(1)
      const y = max === min ? height / 2 : inset + ((max - v) / span) * (height - inset * 2)
      return `${i ? 'L' : 'M'}${x} ${Number(y).toFixed(1)}`
    })
    .join(' ')
}

export function Sparkline({ values, tone = 'cyan', width = 310, height = 48, className = '', label }) {
  const offline = !values || values.length < 2
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`block max-w-full shrink-0 ${className}`}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      preserveAspectRatio="none"
    >
      <path
        d={sparkPath(values, width, height)}
        fill="none"
        stroke={STROKE[offline ? 'faint' : tone] || STROKE.cyan}
        strokeWidth={2}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

export default Sparkline
