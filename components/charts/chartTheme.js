/**
 * Paper chart styling (01 Home, 10 Analytics): faint 11px axis labels, hairline
 * grid in the line colour, no dots, 2px lines. Colours are CSS variables so the
 * light theme follows without a re-render.
 */
export const AXIS_TICK = { fill: 'var(--faint)', fontSize: 11 }
export const GRID = { stroke: 'var(--line)', strokeDasharray: '0', vertical: false }
export const TOOLTIP = {
  contentStyle: {
    background: 'var(--surface-2)',
    border: '1px solid var(--line-strong)',
    borderRadius: 14,
    color: 'var(--text)',
    fontSize: 12,
    boxShadow: 'var(--shadow-card)',
  },
  labelStyle: { color: 'var(--muted)' },
  itemStyle: { color: 'var(--text)' },
  cursor: { stroke: 'var(--line-strong)' },
}
export const SERIES = ['var(--cyan)', 'var(--pink)', 'var(--good)', 'var(--warn)', 'var(--alert)', 'var(--muted)']

/**
 * Paper 01 Home area chart: a #1562D6 → light-sky stroke and a blue fade
 * fill (theme.css --chart-*), referenced as url(#<id>-stroke) / url(#<id>-fill).
 */
export function BrandGradients({ id }) {
  return (
    <defs>
      <linearGradient id={`${id}-stroke`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" style={{ stopColor: 'var(--chart-line-start)' }} />
        <stop offset="100%" style={{ stopColor: 'var(--chart-line-end)' }} />
      </linearGradient>
      <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" style={{ stopColor: 'var(--chart-area)', stopOpacity: 'var(--chart-area-opacity)' }} />
        <stop offset="100%" style={{ stopColor: 'var(--chart-area)', stopOpacity: 0 }} />
      </linearGradient>
    </defs>
  )
}

/** Paper 01 Home: the latest point as a lime dot (r 4, 4.5 with a stroke on light) in an 8px halo. */
export function LastPointDot({ cx, cy, index, points }) {
  if (cx == null || cy == null || index !== points.length - 1) return null
  return (
    <g key={`last-${index}`}>
      <circle cx={cx} cy={cy} r={8} style={{ fill: 'var(--chart-point-halo)' }} />
      <circle cx={cx} cy={cy} r={4} style={{ fill: 'var(--chart-point)', stroke: 'var(--chart-point-stroke)' }} />
    </g>
  )
}
