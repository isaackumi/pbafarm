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
          <ReferenceArea x1={harvest.label} x2={harvest.label} yAxisId="feed" fill="var(--cyan)" fillOpacity={0.08} stroke="none" />
        ) : null}
        <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} interval={0} />
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
          stroke="var(--cyan)"
          strokeWidth={2.5}
          dot={false}
          activeDot={{ r: 4, fill: 'var(--cyan)', stroke: 'var(--surface)' }}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
