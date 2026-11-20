/**
 * Cycle planner chart (Paper 50): feed per month as bars, the average weight
 * as a line on its own axis, and the harvest month shaded. Loaded through
 * next/dynamic so recharts stays out of the first load; labels come from the
 * page (i18n).
 */
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { AXIS_TICK, GRID, TOOLTIP } from './chartTheme'

/** Paper 50: the harvest point is a 5px lime dot with its weight ("400 g") beside it. */
function HarvestPoint({ cx, cy, label }) {
  if (cx == null || cy == null) return null
  return (
    <g>
      <circle cx={cx} cy={cy} r={5} fill="#D7F75B" />
      <text x={cx - 5} y={cy + 20} textAnchor="end" fontFamily="var(--font-data)" fontSize={11} fill="#D7F75B">
        {label}
      </text>
    </g>
  )
}

/** Month labels; the harvest month ("Aug · harvest") is lime and semibold (Paper 50). */
function MonthTick({ x, y, payload, harvestLabel }) {
  const harvest = payload?.value === harvestLabel
  return (
    <text x={x} y={y + 12} textAnchor="middle" fontSize={12} fill={harvest ? '#D7F75B' : 'var(--muted)'} fontWeight={harvest ? 600 : 400}>
      {payload?.value}
    </text>
  )
}

/**
 * @param {{ data: {label: string, feedT: number, abwG: number, harvest: boolean}[],
 *   labels: {feed: string, weight: string}, formatFeed: (t: number) => string, formatWeight: (g: number) => string }} props
 */
export default function CyclePlanChart({ data, labels, formatFeed, formatWeight }) {
  const harvest = data.find((d) => d.harvest)
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 20, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid {...GRID} />
        {harvest ? (
          <ReferenceArea x1={harvest.label} x2={harvest.label} yAxisId="feed" fill="#D7F75B" fillOpacity={0.07} stroke="none" />
        ) : null}
        <XAxis dataKey="label" tick={<MonthTick harvestLabel={harvest?.label} />} axisLine={false} tickLine={false} interval={0} />
        <YAxis yAxisId="feed" hide domain={[0, (max) => max * 1.15]} />
        <YAxis yAxisId="abw" orientation="right" hide domain={[0, (max) => max * 1.1]} />
        <Tooltip
          {...TOOLTIP}
          cursor={{ fill: 'var(--surface-2)' }}
          formatter={(v, name, item) => [item.dataKey === 'feedT' ? formatFeed(v) : formatWeight(v), name]}
        />
        <Bar yAxisId="feed" dataKey="feedT" name={labels.feed} fill="var(--line-strong)" radius={[4, 4, 0, 0]} maxBarSize={44} isAnimationActive={false}>
          <LabelList dataKey="feedT" position="top" formatter={(v) => formatFeed(v)} style={{ fill: 'var(--muted)', fontSize: 11 }} />
        </Bar>
        <Line
          yAxisId="abw"
          type="monotone"
          dataKey="abwG"
          name={labels.weight}
          stroke="#D7F75B"
          strokeWidth={2.5}
          strokeLinecap="round"
          dot={(p) => (p.payload?.harvest ? <HarvestPoint key={p.index} {...p} label={formatWeight(p.payload.abwG)} /> : <g key={p.index} />)}
          activeDot={{ r: 4, fill: '#D7F75B', stroke: 'var(--surface)' }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
