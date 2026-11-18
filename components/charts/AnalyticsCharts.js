/**
 * Analytics charts (Phase 13). Loaded through next/dynamic so recharts stays
 * out of the first page load. Colors are theme tokens (styles/theme.css,
 * dataviz reference palette validated on the app surfaces in both modes);
 * every chart has a table twin on the page.
 */
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  Cell,
} from 'recharts'

const AXIS = { fill: 'var(--muted)', fontSize: 12 }
const TOOLTIP = {
  contentStyle: {
    borderRadius: 8,
    border: '1px solid var(--foam-deep)',
    background: 'var(--surface)',
    color: 'var(--chart-ink)',
    fontSize: 13,
  },
  labelStyle: { color: 'var(--chart-ink)', fontWeight: 600 },
  itemStyle: { color: 'var(--chart-ink)' },
}

const shortDate = (iso) => {
  if (!iso) return ''
  const d = new Date(`${iso}T12:00:00Z`)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/**
 * One measure across units or cycles, ranked. Signed measures (margin) put
 * losses in the negative color on the other side of a zero line.
 */
export function RankedBars({ data, format = (v) => v, label, signed = false }) {
  const height = Math.max(160, data.length * 36 + 40)
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }} barCategoryGap={2}>
          <CartesianGrid horizontal={false} stroke="var(--viz-grid)" />
          <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} tickFormatter={format} />
          <YAxis
            type="category"
            dataKey="name"
            tick={AXIS}
            axisLine={false}
            tickLine={false}
            width={88}
          />
          {signed && <ReferenceLine x={0} stroke="var(--viz-axis)" />}
          <Tooltip {...TOOLTIP} cursor={{ fill: 'var(--foam)' }} formatter={(v) => [format(v), label]} />
          <Bar dataKey="value" name={label} radius={[0, 4, 4, 0]} maxBarSize={24} isAnimationActive={false}>
            {data.map((d) => (
              <Cell
                key={d.name}
                fill={signed && d.value < 0 ? 'var(--viz-negative)' : 'var(--series-1)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** ABW of one cycle against the farm's target curve. */
export function GrowthChart({ points }) {
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
          <XAxis dataKey="date" tick={AXIS} axisLine={{ stroke: 'var(--viz-axis)' }} tickLine={false} tickFormatter={shortDate} minTickGap={24} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={44} unit=" g" />
          <Tooltip
            {...TOOLTIP}
            cursor={{ stroke: 'var(--viz-axis)' }}
            labelFormatter={(d) => shortDate(d)}
            formatter={(v, name) => [v == null ? '—' : `${v} g`, name]}
          />
          <Legend wrapperStyle={{ fontSize: 13, color: 'var(--chart-ink)' }} />
          <Line
            type="monotone"
            dataKey="abw_g"
            name="Measured ABW"
            stroke="var(--series-1)"
            strokeWidth={2}
            dot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)', fill: 'var(--series-1)' }}
            activeDot={{ r: 5 }}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="target_g"
            name="Target"
            stroke="var(--series-2)"
            strokeWidth={2}
            strokeDasharray="6 4"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Farm FCR by week: the week's own FCR and the cycle-to-date FCR. */
export function FcrTrendChart({ data }) {
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
          <XAxis dataKey="week_end" tick={AXIS} axisLine={{ stroke: 'var(--viz-axis)' }} tickLine={false} tickFormatter={shortDate} minTickGap={24} />
          <YAxis tick={AXIS} axisLine={false} tickLine={false} width={40} />
          <Tooltip
            {...TOOLTIP}
            cursor={{ stroke: 'var(--viz-axis)' }}
            labelFormatter={(d) => `Week ending ${shortDate(d)}`}
            formatter={(v, name) => [v == null ? '—' : Number(v).toFixed(2), name]}
          />
          <Legend wrapperStyle={{ fontSize: 13, color: 'var(--chart-ink)' }} />
          <Line
            type="monotone"
            dataKey="cycle_fcr"
            name="Cycle-to-date FCR"
            stroke="var(--series-1)"
            strokeWidth={2}
            dot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)', fill: 'var(--series-1)' }}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="week_fcr"
            name="Week FCR"
            stroke="var(--series-2)"
            strokeWidth={2}
            dot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)', fill: 'var(--series-2)' }}
            connectNulls
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
