/**
 * Recharts props in the Paper chart style (09, 10, 28): hairline grid in
 * --line, muted 12px ticks, no axis lines, cyan/pink first series. Colours are
 * CSS variables so both themes work.
 */
export const SERIES = ['var(--cyan)', 'var(--pink)', 'var(--good)', 'var(--warn)', 'var(--muted)', 'var(--alert)']

export const gridProps = { stroke: 'var(--line)', strokeDasharray: '0', vertical: false }

export const axisProps = {
  tick: { fill: 'var(--muted)', fontSize: 12 },
  tickLine: false,
  axisLine: false,
}

export const tooltipProps = {
  contentStyle: {
    background: 'var(--surface-2)',
    border: '1px solid var(--line)',
    borderRadius: 12,
    color: 'var(--text)',
    fontSize: 12,
  },
  labelStyle: { color: 'var(--muted)' },
  itemStyle: { color: 'var(--text)' },
  cursor: { fill: 'var(--surface-2)', stroke: 'var(--line)' },
}

export const legendProps = { wrapperStyle: { fontSize: 12, color: 'var(--muted)' }, iconType: 'circle', iconSize: 8 }
