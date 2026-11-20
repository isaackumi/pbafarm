/**
 * Home charts, split out so recharts loads after the page renders
 * (MOBILE-008). Imported only through next/dynamic in Dashboard.js.
 * Styling: Paper 01 Home (blue gradient area, no grid or y axis, 12px faint
 * date labels, lime last point).
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
import { AXIS_TICK, GRID, TOOLTIP, BrandGradients, LastPointDot } from './chartTheme'

export function FeedTrendChart({ feedTrend, dataKey = 'cumulative', name = 'Cumulative kg' }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={feedTrend} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
        <BrandGradients id="feedTrend" />
        <XAxis
          dataKey="label"
          tick={{ ...AXIS_TICK, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          minTickGap={24}
          tickMargin={8}
        />
        <YAxis hide />
        <Tooltip {...TOOLTIP} />
        <Area
          type="monotone"
          dataKey={dataKey}
          name={name}
          stroke="url(#feedTrend-stroke)"
          strokeWidth={2}
          fill="url(#feedTrend-fill)"
          dot={(props) => <LastPointDot {...props} points={feedTrend} />}
          activeDot={{ r: 4, fill: 'var(--chart-point)', stroke: 'var(--surface)' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function MortalityBarsChart({ mortalityBars }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={mortalityBars} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} minTickGap={16} />
        <YAxis allowDecimals={false} tick={AXIS_TICK} axisLine={false} tickLine={false} width={36} />
        <Tooltip {...TOOLTIP} cursor={{ fill: 'var(--surface-2)' }} />
        <Bar dataKey="mortality" name="Fish" radius={[4, 4, 0, 0]} maxBarSize={18}>
          {mortalityBars.map((row, i) => (
            <Cell key={i} fill={row.mortality > 0 ? 'var(--alert)' : 'var(--line-strong)'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
