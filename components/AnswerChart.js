/**
 * A chart under an Ask Anowa answer (convex/lib/answerCharts): data the
 * server drew from the member's records, never written by the model. Loaded
 * through next/dynamic (AnswerCharts) so recharts stays off the first load.
 *
 * House chart style (lib/chartTheme, HANDOFF: 2px lines, no dots, hairline
 * grid, cyan then pink), CSS-variable colours so both themes work. Accessible:
 * a titled figure, a text summary for screen readers and a "Show data" table
 * with every point.
 */
import { useId, useMemo, useState } from 'react'
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Table2 } from 'lucide-react'
import { SERIES, axisProps, gridProps, legendProps, tooltipProps } from '../lib/chartTheme'
import { useLocale, useT } from '../lib/i18n/context'

const FOCUS = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan'
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** Rows for recharts: one per x, each series' y (and band) as columns. */
export function chartRows(chart) {
  const order = []
  const rows = new Map()
  for (const s of chart.series) {
    for (const p of s.points) {
      if (!rows.has(p.x)) {
        rows.set(p.x, { x: p.x })
        order.push(p.x)
      }
      const row = rows.get(p.x)
      row[s.key] = p.y
      if (s.band && p.lo != null && p.hi != null) row[`${s.key}Band`] = [p.lo, p.hi]
    }
  }
  const xs = chart.xKind === 'date' ? [...order].sort() : order
  return xs.map((x) => rows.get(x))
}

export default function AnswerChart({ chart }) {
  const t = useT()
  const { locale } = useLocale()
  const id = useId()
  const [table, setTable] = useState(false)
  const rows = useMemo(() => chartRows(chart), [chart])
  const units = useMemo(() => [...new Set(chart.series.map((s) => s.unit))].slice(0, 2), [chart])
  const num = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }), [locale])
  const dateFmt = useMemo(() => new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' }), [locale])
  const fmtX = (x) => (DAY.test(x) ? dateFmt.format(new Date(`${x}T00:00:00Z`)) : x)
  const unitOf = (s) => (s.unit ? ` ${s.unit}` : '')
  const axisOf = (s) => (units.length > 1 && s.unit === units[1] ? 'right' : 'left')
  const summary = t('askAnowa.chart.summary', {
    title: chart.title,
    series: chart.series.map((s) => s.label).join(', '),
    from: fmtX(rows[0]?.x ?? ''),
    to: fmtX(rows[rows.length - 1]?.x ?? ''),
    count: rows.length,
  })

  return (
    <figure aria-labelledby={`${id}-title`} className="mt-4 flex flex-col gap-3 rounded-card border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <figcaption id={`${id}-title`} className="text-[14px] font-medium leading-[18px] text-text">
          {chart.title}
          {chart.source && <span className="mt-[2px] block text-xs font-normal leading-4 text-faint">{chart.source}</span>}
        </figcaption>
        <button
          type="button"
          onClick={() => setTable(!table)}
          aria-expanded={table}
          aria-controls={`${id}-table`}
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-pill px-2 py-1 text-xs leading-4 text-muted hover:text-text ${FOCUS}`}
        >
          <Table2 size={14} aria-hidden />
          {table ? t('askAnowa.chart.hideData') : t('askAnowa.chart.showData')}
        </button>
      </div>
      <div className="h-56 w-full" role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: units.length > 1 ? 4 : 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="x" {...axisProps} tickFormatter={fmtX} minTickGap={24} />
            <YAxis yAxisId="left" {...axisProps} width={48} tickFormatter={(v) => num.format(v)} />
            {units.length > 1 && <YAxis yAxisId="right" orientation="right" {...axisProps} width={40} tickFormatter={(v) => num.format(v)} />}
            <Tooltip
              {...tooltipProps}
              labelFormatter={fmtX}
              formatter={(v, name) => [Array.isArray(v) ? v.map((x) => num.format(x)).join(' – ') : num.format(v), name]}
            />
            {chart.series.length > 1 && <Legend {...legendProps} />}
            {chart.series.flatMap((s, i) => {
              const color = SERIES[i % SERIES.length]
              const common = { dataKey: s.key, name: `${s.label}${unitOf(s)}`, yAxisId: axisOf(s), isAnimationActive: false }
              const band = s.band
                ? [
                    <Area
                      key={`${s.key}Band`}
                      dataKey={`${s.key}Band`}
                      name={t('askAnowa.chart.range', { label: s.label })}
                      yAxisId={axisOf(s)}
                      stroke="none"
                      fill={color}
                      fillOpacity={0.14}
                      isAnimationActive={false}
                      legendType="none"
                    />,
                  ]
                : []
              if (chart.type === 'bar') return [...band, <Bar key={s.key} {...common} fill={color} radius={[4, 4, 0, 0]} maxBarSize={28} />]
              if (chart.type === 'area' && !s.band) {
                return [...band, <Area key={s.key} {...common} type="monotone" stroke={color} strokeWidth={2} fill={color} fillOpacity={0.12} connectNulls />]
              }
              return [...band, <Line key={s.key} {...common} type="monotone" stroke={color} strokeWidth={2} dot={false} connectNulls />]
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {table && (
        <div id={`${id}-table`} className="max-h-64 overflow-auto rounded-[10px] border border-line">
          <table className="w-full text-left text-xs leading-4">
            <caption className="sr-only">{chart.title}</caption>
            <thead className="sticky top-0 bg-surface-2 text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  {chart.xKind === 'date' ? t('askAnowa.chart.date') : t('askAnowa.chart.period')}
                </th>
                {chart.series.map((s) => (
                  <th key={s.key} scope="col" className="px-3 py-2 text-right font-medium">
                    {s.label}
                    {s.unit ? ` (${s.unit})` : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-data text-text">
              {rows.map((r) => (
                <tr key={r.x} className="border-t border-line">
                  <th scope="row" className="px-3 py-[6px] font-normal text-muted">
                    {fmtX(r.x)}
                  </th>
                  {chart.series.map((s) => (
                    <td key={s.key} className="px-3 py-[6px] text-right">
                      {r[s.key] == null ? '—' : num.format(r[s.key])}
                      {r[`${s.key}Band`] ? (
                        <span className="text-faint"> ({r[`${s.key}Band`].map((x) => num.format(x)).join('–')})</span>
                      ) : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  )
}
