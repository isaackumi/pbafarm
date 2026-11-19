/**
 * One water-quality parameter over time with its threshold band. Loaded via
 * next/dynamic so recharts stays out of the first load (MOBILE-008).
 */
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AXIS_TICK, GRID, TOOLTIP } from './chartTheme'

const fmtTime = (ms) =>
  new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

export default function WaterQualityChart({ points, range, unit, label }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          tickFormatter={fmtTime}
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={AXIS_TICK}
          axisLine={false}
          tickLine={false}
          width={40}
          domain={['auto', 'auto']}
        />
        <Tooltip
          labelFormatter={(ms) => new Date(ms).toLocaleString()}
          formatter={(v) => [`${v}${unit ? ` ${unit}` : ''}`, label]}
          {...TOOLTIP}
        />
        {range?.min != null && (
          <ReferenceLine y={range.min} stroke="var(--alert)" strokeDasharray="4 4" label={{ value: `min ${range.min}`, fill: 'var(--alert)', fontSize: 11, position: 'insideBottomRight' }} />
        )}
        {range?.max != null && (
          <ReferenceLine y={range.max} stroke="var(--alert)" strokeDasharray="4 4" label={{ value: `max ${range.max}`, fill: 'var(--alert)', fontSize: 11, position: 'insideTopRight' }} />
        )}
        <Line
          type="monotone"
          dataKey="v"
          name={label}
          stroke="var(--cyan)"
          strokeWidth={2}
          dot={{ r: 2.5, fill: 'var(--cyan)', strokeWidth: 0 }}
          isAnimationActive={false}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
