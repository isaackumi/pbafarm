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

const fmtTime = (ms) =>
  new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

export default function WaterQualityChart({ points, range, unit, label }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={points} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          tickFormatter={fmtTime}
          tick={{ fill: '#71717a', fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: '#71717a', fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={40}
          domain={['auto', 'auto']}
        />
        <Tooltip
          labelFormatter={(ms) => new Date(ms).toLocaleString()}
          formatter={(v) => [`${v}${unit ? ` ${unit}` : ''}`, label]}
          contentStyle={{ borderRadius: 12, border: '1px solid #e4e4e7' }}
        />
        {range?.min != null && (
          <ReferenceLine y={range.min} stroke="#dc2626" strokeDasharray="4 4" label={{ value: `min ${range.min}`, fill: '#dc2626', fontSize: 11, position: 'insideBottomRight' }} />
        )}
        {range?.max != null && (
          <ReferenceLine y={range.max} stroke="#dc2626" strokeDasharray="4 4" label={{ value: `max ${range.max}`, fill: '#dc2626', fontSize: 11, position: 'insideTopRight' }} />
        )}
        <Line
          type="monotone"
          dataKey="v"
          name={label}
          stroke="#0e7490"
          strokeWidth={2}
          dot={{ r: 3 }}
          isAnimationActive={false}
          connectNulls
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
