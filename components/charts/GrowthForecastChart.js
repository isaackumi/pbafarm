/**
 * Cage growth with its forecast (AI-004): sampled ABW, the expected
 * projection (dashed) and its low–high band, the target weight and today.
 * Loaded through next/dynamic; labels come from the page (i18n).
 */
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from 'recharts'
import { AXIS_TICK, GRID, TOOLTIP } from './chartTheme'

const ts = (iso) => Date.parse(`${iso}T12:00:00Z`)
const short = (t) =>
  new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
const g = (v) => (v == null ? '—' : `${Math.round(v).toLocaleString()} g`)

/**
 * @param {{ samples: {date: string, abw: number}[], series: {date: string, low: number, expected: number, high: number}[],
 *   asOf: string, targetG?: number, labels: {actual: string, expected: string, band: string, target: string, today: string} }} props
 */
export default function GrowthForecastChart({ samples, series, asOf, targetG, labels }) {
  const byDate = new Map()
  for (const s of samples) byDate.set(s.date, { t: ts(s.date), actual: s.abw })
  for (const p of series) {
    const row = byDate.get(p.date) ?? { t: ts(p.date) }
    row.expected = p.expected
    row.band = [p.low, p.high]
    byDate.set(p.date, row)
  }
  const data = [...byDate.values()].sort((a, b) => a.t - b.t)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          tickFormatter={short}
          minTickGap={24}
        />
        <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} width={44} />
        <Tooltip
          {...TOOLTIP}
          labelFormatter={short}
          formatter={(v, name) => [Array.isArray(v) ? `${g(v[0])} – ${g(v[1])}` : g(v), name]}
        />
        <Area
          dataKey="band"
          name={labels.band}
          stroke="none"
          fill="var(--cyan)"
          fillOpacity={0.16}
          connectNulls
          isAnimationActive={false}
        />
        <Line
          dataKey="expected"
          name={labels.expected}
          stroke="var(--cyan)"
          strokeWidth={2}
          strokeDasharray="6 4"
          dot={false}
          connectNulls
          isAnimationActive={false}
        />
        <Line
          dataKey="actual"
          name={labels.actual}
          stroke="var(--pink)"
          strokeWidth={2}
          dot={{ r: 3, strokeWidth: 2, stroke: 'var(--surface)', fill: 'var(--pink)' }}
          connectNulls
          isAnimationActive={false}
        />
        {targetG ? (
          <ReferenceLine y={targetG} stroke="var(--muted)" strokeDasharray="2 4" label={{ value: labels.target, fill: 'var(--muted)', fontSize: 11, position: 'insideTopLeft' }} />
        ) : null}
        <ReferenceLine x={ts(asOf)} stroke="var(--line-strong)" label={{ value: labels.today, fill: 'var(--muted)', fontSize: 11, position: 'insideTopRight' }} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
