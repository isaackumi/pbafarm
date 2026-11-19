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

/** Pink → cyan stroke and a cyan fade fill, referenced as url(#<id>-stroke) / url(#<id>-fill). */
export function BrandGradients({ id }) {
  return (
    <defs>
      <linearGradient id={`${id}-stroke`} x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="var(--pink)" />
        <stop offset="100%" stopColor="var(--cyan)" />
      </linearGradient>
      <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--cyan)" stopOpacity={0.22} />
        <stop offset="100%" stopColor="var(--cyan)" stopOpacity={0} />
      </linearGradient>
    </defs>
  )
}
