/**
 * Home charts, split out so recharts loads after the page renders
 * (MOBILE-008). Imported only through next/dynamic in Dashboard.js.
 */
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts'

export function FeedTrendChart({ feedTrend }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={feedTrend}>
        <defs>
          <linearGradient id="feedFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#18181b" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#18181b" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
        <XAxis
          dataKey="label"
          tick={{ fill: '#71717a', fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: '#71717a', fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={48}
        />
        <Tooltip
          contentStyle={{
            borderRadius: 12,
            border: '1px solid #e4e4e7',
            fontWeight: 600,
          }}
        />
        <Area
          type="monotone"
          dataKey="cumulative"
          name="Cumulative kg"
          stroke="#18181b"
          strokeWidth={3}
          fill="url(#feedFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function MortalityBarsChart({ mortalityBars }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={mortalityBars}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
        <XAxis
          dataKey="label"
          tick={{ fill: '#71717a', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fill: '#71717a', fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={36}
        />
        <Tooltip
          contentStyle={{
            borderRadius: 12,
            border: '1px solid #e4e4e7',
            fontWeight: 600,
          }}
        />
        <Bar dataKey="mortality" name="Fish" radius={[6, 6, 0, 0]}>
          {mortalityBars.map((row, i) => (
            <Cell
              key={i}
              fill={row.mortality > 0 ? '#dc2626' : '#e4e4e7'}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
