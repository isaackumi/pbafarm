import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { EmptyState, Field, GhostButton, Input, KpiStrip, Segmented, Select, Tabs } from '../../components/ui'
import NavTabs from '../../components/ui/NavTabs'
import { api } from '../../convex/_generated/api'
import { useAuth } from '../../contexts/AuthContext'
import { useLocation } from '../../contexts/LocationContext'
import { useCurrency } from '../../hooks/useCurrency'
import { localToday } from '../../lib/format'
import { downloadCsv } from '../../lib/csv'
import { useT } from '../../lib/i18n/context'
import { reportTabs } from '../../lib/sectionTabs'

const chartPlaceholder = () => <div className="h-72 w-full rounded-card bg-surface-2 animate-pulse" />
const RankedBars = dynamic(
  () => import('../../components/charts/AnalyticsCharts').then((m) => m.RankedBars),
  { ssr: false, loading: chartPlaceholder },
)
const GrowthChart = dynamic(
  () => import('../../components/charts/AnalyticsCharts').then((m) => m.GrowthChart),
  { ssr: false, loading: chartPlaceholder },
)
const FcrTrendChart = dynamic(
  () => import('../../components/charts/AnalyticsCharts').then((m) => m.FcrTrendChart),
  { ssr: false, loading: chartPlaceholder },
)

export default function AnalyticsPage() {
  return (
    <ProtectedRoute>
      <Analytics />
    </ProtectedRoute>
  )
}

const TABS = ['compare', 'growth', 'feed', 'mortality', 'cycles']
const PERIODS = [4, 8, 12, 26]

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const lastSunday = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`)
  return addDays(iso, -d.getUTCDay())
}
const fmt = (v, dp = 2) => (v == null || Number.isNaN(v) ? '—' : Number(v).toFixed(dp))
const int = (v) => (v == null ? '—' : Math.round(v).toLocaleString())
const dateLabel = (iso) =>
  iso
    ? new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '—'

function Analytics() {
  const { user } = useAuth()
  const { locationArgs } = useLocation()
  const [tab, setTab] = useState('compare')
  const [weeks, setWeeks] = useState(12)
  const today = localToday()
  const skip = !user

  const t = useT()
  return (
    <Layout title={t('ops.analytics.title')} eyebrow={t('ops.reportsTab.eyebrow')}>
      <div className="flex flex-col gap-[28px]">
        <NavTabs tabs={reportTabs(t)} label={t('ops.tabs.reports')} />
        <p className="max-w-3xl text-[13px] leading-5 text-muted">{t('ops.analytics.description')}</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <Tabs
              variant="page"
              label={t('ops.analytics.viewsLabel')}
              tabs={TABS.map((id) => ({ value: id, label: t(`ops.analytics.tabs.${id}`) }))}
              value={tab}
              onChange={setTab}
            />
          </div>
          {tab !== 'growth' && tab !== 'cycles' && (
            <Field label={t('ops.analytics.period')} htmlFor="analytics-period" className="sm:w-48">
              <Select id="analytics-period" value={weeks} onChange={(e) => setWeeks(Number(e.target.value))}>
                {PERIODS.map((w) => (
                  <option key={w} value={w}>
                    {t('ops.analytics.lastWeeks', { count: w })}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        {tab === 'compare' && <Compare skip={skip} today={today} weeks={weeks} locationArgs={locationArgs} />}
        {tab === 'growth' && <Growth skip={skip} today={today} locationArgs={locationArgs} />}
        {tab === 'feed' && <FeedEfficiency skip={skip} today={today} weeks={weeks} locationArgs={locationArgs} />}
        {tab === 'mortality' && <Mortality skip={skip} today={today} weeks={weeks} locationArgs={locationArgs} />}
        {tab === 'cycles' && <Cycles skip={skip} locationArgs={locationArgs} />}
      </div>
    </Layout>
  )
}

const CARD = 'min-w-0 rounded-card border border-line bg-surface shadow-[var(--shadow-card)]'

/** Paper card (P-LIST / 11 Reports panels); `padding={false}` for full-bleed tables. */
function Card({ padding = true, className = '', children }) {
  return <section className={`${CARD} ${padding ? 'px-5 py-6 sm:px-[26px]' : 'overflow-hidden'} ${className}`}>{children}</section>
}

function CardHeader({ title, subtitle, action }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold leading-[18px] text-text">{title}</h2>
        {subtitle && <p className="mt-1 text-[13px] leading-5 text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

function Loading() {
  return <div className="h-64 rounded-card bg-surface-2 animate-pulse" aria-busy="true" aria-label="Loading" />
}

function NoData({ what }) {
  return (
    <Card>
      <EmptyState
        title={`No ${what} yet`}
        description="Figures appear once units have stockings, daily entries and samples, and the rollups have run."
      />
    </Card>
  )
}

function ExportButton({ onClick }) {
  return (
    <GhostButton size="sm" onClick={onClick}>
      Export CSV
    </GhostButton>
  )
}

function Table({ caption, columns, rows, rowKey }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-[13px] leading-5">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-y border-line text-left text-xs text-faint">
            {columns.map((c) => (
              <th key={c.key} scope="col" className={`px-5 py-3 font-medium whitespace-nowrap sm:px-[26px] ${c.num ? 'text-right' : ''}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} className="border-b border-line last:border-b-0 hover:bg-surface-2">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-5 py-3 whitespace-nowrap text-text sm:px-[26px] ${c.num ? 'text-right tabular-nums' : ''} ${c.className?.(r) ?? ''}`}
                >
                  {c.render ? c.render(r) : r[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

function Compare({ skip, today, weeks, locationArgs }) {
  const { formatCurrency } = useCurrency()
  const to = lastSunday(today)
  const from = addDays(to, -7 * weeks + 1)
  const data = useQuery(api.analytics.comparison, skip ? 'skip' : { from, to, ...locationArgs })
  const [metric, setMetric] = useState('fcr')
  const [level, setLevel] = useState('units')

  const METRICS = useMemo(
    () => ({
      fcr: { label: 'FCR', format: (v) => fmt(v) },
      sgr_pct_day: { label: 'SGR (% per day)', format: (v) => fmt(v) },
      survival_pct: { label: 'Survival (%)', format: (v) => fmt(v, 1) },
      biomass_kg: { label: 'Biomass (kg)', format: (v) => int(v) },
      cost_per_kg_produced: { label: 'Cost per kg produced', format: (v) => (v == null ? '—' : formatCurrency(v)), money: true },
      net_margin: { label: 'Net margin', format: (v) => formatCurrency(v ?? 0), signed: true, money: true },
    }),
    [formatCurrency],
  )

  if (data === undefined) return <Loading />
  const rows = level === 'sites' ? data.sites : data.units
  if (!data.units.length && !data.sites.length) return <NoData what="production in this period" />

  // Costs and revenue come back only with permission to see finance.
  const money = 'total_cost' in data.farm
  const metrics = Object.fromEntries(Object.entries(METRICS).filter(([, v]) => money || !v.money))
  const m = metrics[metric] ?? metrics.fcr
  const chart = rows
    .filter((r) => r[metric] != null)
    .map((r) => ({ name: r.name, value: r[metric] }))
    .sort((a, b) => b.value - a.value)

  const columns = [
    { key: 'name', label: level === 'sites' ? 'Site' : 'Unit' },
    ...(level === 'units' ? [{ key: 'site_name', label: 'Site', render: (r) => r.site_name ?? '—' }] : []),
    { key: 'fcr', label: 'FCR', num: true, render: (r) => fmt(r.fcr) },
    { key: 'sgr_pct_day', label: 'SGR %/d', num: true, render: (r) => fmt(r.sgr_pct_day) },
    { key: 'survival_pct', label: 'Survival %', num: true, render: (r) => fmt(r.survival_pct, 1) },
    { key: 'mortality', label: 'Deaths', num: true, render: (r) => int(r.mortality) },
    { key: 'biomass_kg', label: 'Biomass kg', num: true, render: (r) => int(r.biomass_kg) },
    { key: 'feed_kg', label: 'Feed kg', num: true, render: (r) => int(r.feed_kg) },
    { key: 'gain_kg', label: 'Gain kg', num: true, render: (r) => int(r.gain_kg) },
    ...(money
      ? [
          { key: 'total_cost', label: 'Cost', num: true, render: (r) => formatCurrency(r.total_cost) },
          { key: 'cost_per_kg_produced', label: 'Cost/kg produced', num: true, render: (r) => (r.cost_per_kg_produced == null ? '—' : formatCurrency(r.cost_per_kg_produced)) },
          { key: 'revenue', label: 'Revenue', num: true, render: (r) => formatCurrency(r.revenue) },
          {
            key: 'net_margin',
            label: 'Margin',
            num: true,
            render: (r) => formatCurrency(r.net_margin),
            className: (r) => (r.net_margin < 0 ? 'text-alert' : ''),
          },
        ]
      : []),
  ]

  const exportCsv = () =>
    downloadCsv(
      `comparison-${level}-${from}-to-${to}.csv`,
      columns.map((c) => c.label),
      rows.map((r) => columns.map((c) => (c.key === 'name' || c.key === 'site_name' ? r[c.key] : r[c.key]))),
    )

  return (
    <div className="space-y-6">
      <KpiStrip
        items={[
          { label: 'Farm FCR', value: fmt(data.farm.fcr), suffix: `${dateLabel(from)} – ${dateLabel(to)}` },
          { label: 'Survival', value: fmt(data.farm.survival_pct, 1), suffix: '%' },
          { label: 'Standing biomass', value: int(data.farm.biomass_kg), suffix: 'kg' },
          money
            ? {
                label: 'Cost per kg produced',
                value: data.farm.cost_per_kg_produced == null ? '—' : formatCurrency(data.farm.cost_per_kg_produced),
              }
            : { label: 'Feed', value: int(data.farm.feed_kg), suffix: 'kg' },
        ]}
      />
      <Card>
        <CardHeader
          title={`${m.label} by ${level === 'sites' ? 'site' : 'unit'}`}
          subtitle="Ranked; hover a bar for its value. The table below has every figure."
          action={
            <div className="flex flex-wrap gap-2">
              <Segmented
                label="Level"
                options={[
                  { value: 'units', label: 'Units' },
                  { value: 'sites', label: 'Sites' },
                ]}
                value={level}
                onChange={setLevel}
              />
              <label htmlFor="compare-metric" className="sr-only">
                Measure
              </label>
              <Select id="compare-metric" value={metrics[metric] ? metric : 'fcr'} onChange={(e) => setMetric(e.target.value)} className="sm:w-56">
                {Object.entries(metrics).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </Select>
            </div>
          }
        />
        {chart.length ? (
          <RankedBars data={chart} format={m.format} label={m.label} signed={!!m.signed} />
        ) : (
          <EmptyState title={`No ${m.label} for this period`} description="It needs feed, growth samples or costs in the period." />
        )}
      </Card>
      <Card padding={false}>
        <div className="px-5 py-6 sm:px-[26px] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold leading-[18px] text-text">
              {level === 'sites' ? 'Sites' : 'Units'} side by side
            </h2>
            <p className="text-[13px] leading-5 text-muted mt-1">
              Weeks run Monday to Sunday.
              {money
                ? ' Cost per kg produced is total cost over weight gained.'
                : ' Costs and revenue need permission to see finance.'}
            </p>
          </div>
          <ExportButton onClick={exportCsv} />
        </div>
        <Table caption="Comparison" columns={columns} rows={rows} rowKey={(r) => r.id ?? r.name} />
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Growth and forecast
// ---------------------------------------------------------------------------

function Growth({ skip, today, locationArgs }) {
  const [forecastOn, setForecastOn] = useState(addDays(today, 30))
  const [targetAbw, setTargetAbw] = useState('')
  const args = skip
    ? 'skip'
    : {
        asOf: today,
        forecastOn,
        ...(Number(targetAbw) > 0 ? { targetAbwG: Number(targetAbw) } : {}),
        ...locationArgs,
      }
  const data = useQuery(api.analytics.growth, args)
  const [selected, setSelected] = useState('')

  if (data === undefined) return <Loading />
  if (!data.occupancies.length) return <NoData what="open cycles" />
  const current =
    data.occupancies.find((o) => `${o.unit_id}|${o.batch_id}` === selected) ?? data.occupancies[0]

  const exportCsv = () =>
    downloadCsv(
      `harvest-forecast-${data.forecast_on}.csv`,
      ['Unit', 'Site', 'Batch', 'Days of culture', 'Fish', 'ABW g', 'SGR %/d', 'SGR from', `ABW g on ${data.forecast_on}`, `Biomass kg on ${data.forecast_on}`, `Ready for ${data.target.harvest_abw_g} g`],
      data.occupancies.map((o) => [
        o.unit_name,
        o.site_name ?? '',
        o.batch_number,
        o.days_of_culture,
        o.count,
        o.abw_g,
        o.forecast?.sgr_pct_day,
        o.forecast?.sgr_source,
        o.forecast?.projected_abw_g,
        o.forecast?.projected_biomass_kg,
        o.forecast?.harvest_ready_on,
      ]),
    )

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Growth against target"
          subtitle={`Target: ${data.target.abw_g} g at ${data.target.days} days of culture (farm rules), at a constant growth rate from the stocking weight.`}
          action={
            <div className="w-full sm:w-72">
              <label htmlFor="growth-cycle" className="sr-only">
                Cycle
              </label>
              <Select id="growth-cycle" value={`${current.unit_id}|${current.batch_id}`} onChange={(e) => setSelected(e.target.value)}>
                {data.occupancies.map((o) => (
                  <option key={`${o.unit_id}|${o.batch_id}`} value={`${o.unit_id}|${o.batch_id}`}>
                    {o.unit_name} · {o.batch_number}
                  </option>
                ))}
              </Select>
            </div>
          }
        />
        <GrowthChart points={current.curve} />
        <p className="text-xs text-muted mt-3">
          Measured ABW comes from bi-weekly samples (stocking weight before the first one). Dashed line: target.
        </p>
      </Card>

      <Card padding={false}>
        <div className="px-5 py-6 sm:px-[26px] space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold leading-[18px] text-text">Harvest forecast</h2>
              <p className="text-[13px] leading-5 text-muted mt-1">
                Weight projected at the growth rate between the last two samples (the cycle&apos;s rate with one sample), fish at the last 28 days&apos; death rate.
              </p>
            </div>
            <ExportButton onClick={exportCsv} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
            <Field label="Project to" htmlFor="forecast-on">
              <Input id="forecast-on" type="date" value={forecastOn} min={today} onChange={(e) => setForecastOn(e.target.value || addDays(today, 30))} />
            </Field>
            <Field label="Harvest weight (g)" htmlFor="target-abw" hint={`Farm rule: ${data.target.abw_g} g`}>
              <Input id="target-abw" type="number" inputMode="decimal" min="1" placeholder={String(data.target.abw_g)} value={targetAbw} onChange={(e) => setTargetAbw(e.target.value)} />
            </Field>
          </div>
        </div>
        <Table
          caption="Harvest forecast"
          rowKey={(o) => `${o.unit_id}|${o.batch_id}`}
          rows={data.occupancies}
          columns={[
            { key: 'unit_name', label: 'Unit' },
            { key: 'batch_number', label: 'Batch' },
            { key: 'days_of_culture', label: 'DOC', num: true },
            { key: 'count', label: 'Fish', num: true, render: (o) => int(o.count) },
            { key: 'abw_g', label: 'ABW g', num: true, render: (o) => fmt(o.abw_g, 1) },
            { key: 'sgr', label: 'SGR %/d', num: true, render: (o) => fmt(o.forecast?.sgr_pct_day) },
            { key: 'p_abw', label: `ABW on ${dateLabel(data.forecast_on)}`, num: true, render: (o) => fmt(o.forecast?.projected_abw_g, 1) },
            { key: 'p_bio', label: 'Biomass kg', num: true, render: (o) => int(o.forecast?.projected_biomass_kg) },
            { key: 'ready', label: `Ready for ${data.target.harvest_abw_g} g`, render: (o) => dateLabel(o.forecast?.harvest_ready_on) },
          ]}
        />
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Feed efficiency
// ---------------------------------------------------------------------------

function useTrends(skip, today, weeks, locationArgs) {
  return useQuery(api.analytics.trends, skip ? 'skip' : { asOf: today, weeks, ...locationArgs })
}

function FeedEfficiency({ skip, today, weeks, locationArgs }) {
  const data = useTrends(skip, today, weeks, locationArgs)
  if (data === undefined) return <Loading />
  if (!data.units.length) return <NoData what="feed records" />

  const exportCsv = () =>
    downloadCsv(
      `feed-efficiency-${data.weeks[data.weeks.length - 1]}.csv`,
      ['Unit', 'Site', 'Week ending', 'Feed kg', 'Gain kg', 'Week FCR', 'Cycle-to-date FCR'],
      data.units.flatMap((u) =>
        u.series.map((w) => [u.unit_name, u.site_name ?? '', w.week_end, w.feed_kg, w.gain_kg, w.week_fcr, w.cycle_fcr]),
      ),
    )

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Farm FCR by week"
          subtitle="Week FCR is that week's feed over that week's gain; it jumps on sample weeks. Cycle-to-date FCR is steadier."
        />
        <FcrTrendChart data={data.farm} />
      </Card>
      <Card padding={false}>
        <div className="px-5 py-6 sm:px-[26px] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold leading-[18px] text-text">Cycle-to-date FCR per unit</h2>
            <p className="text-[13px] leading-5 text-muted mt-1">At the end of each week (Sunday).</p>
          </div>
          <ExportButton onClick={exportCsv} />
        </div>
        <Table
          caption="Cycle-to-date FCR per unit and week"
          rowKey={(u) => u.unit_id}
          rows={data.units}
          columns={[
            { key: 'unit_name', label: 'Unit' },
            ...data.weeks.map((w, i) => ({
              key: w,
              label: dateLabel(w).replace(/,? \d{4}$/, ''),
              num: true,
              render: (u) => fmt(u.series[i].cycle_fcr),
            })),
          ]}
        />
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mortality heatmap
// ---------------------------------------------------------------------------

/** Mortality % bins (upper bounds) for the 7 sequential steps. */
const BINS = [0.25, 0.5, 1, 2, 4, 8, Infinity]
const BIN_LABELS = ['≤0.25', '≤0.5', '≤1', '≤2', '≤4', '≤8', '>8']
const binOf = (pct) => BINS.findIndex((b) => pct <= b)

function Mortality({ skip, today, weeks, locationArgs }) {
  const data = useTrends(skip, today, weeks, locationArgs)
  const [showTable, setShowTable] = useState(false)
  if (data === undefined) return <Loading />
  if (!data.units.length) return <NoData what="mortality records" />

  const exportCsv = () =>
    downloadCsv(
      `mortality-by-week-${data.weeks[data.weeks.length - 1]}.csv`,
      ['Unit', 'Site', 'Week ending', 'Deaths', 'Mortality %'],
      data.units.flatMap((u) =>
        u.series.map((w) => [u.unit_name, u.site_name ?? '', w.week_end, w.mortality, w.mortality_pct]),
      ),
    )

  const short = (w) => dateLabel(w).replace(/,? \d{4}$/, '')
  return (
    <Card padding={false}>
      <div className="px-5 py-6 sm:px-[26px] flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold leading-[18px] text-text">Mortality by unit and week</h2>
          <p className="text-[13px] leading-5 text-muted mt-1">
            Deaths in the week as a share of the fish at its end plus those deaths. Darker is worse.
          </p>
        </div>
        <div className="flex gap-2">
          <GhostButton size="sm" onClick={() => setShowTable((s) => !s)} aria-pressed={showTable}>
            {showTable ? 'Show heatmap' : 'Show table'}
          </GhostButton>
          <ExportButton onClick={exportCsv} />
        </div>
      </div>
      {showTable ? (
        <Table
          caption="Deaths and mortality % per unit and week"
          rowKey={(u) => u.unit_id}
          rows={data.units}
          columns={[
            { key: 'unit_name', label: 'Unit' },
            ...data.weeks.map((w, i) => ({
              key: w,
              label: short(w),
              num: true,
              render: (u) => {
                const c = u.series[i]
                return c.units ? `${c.mortality} (${fmt(c.mortality_pct)}%)` : '—'
              },
            })),
          ]}
        />
      ) : (
        <div className="px-5 sm:px-6 pb-6">
          <div className="overflow-x-auto">
            <table className="border-separate" style={{ borderSpacing: 2 }}>
              <caption className="sr-only">Mortality % per unit and week</caption>
              <thead>
                <tr>
                  <th scope="col" className="text-left text-xs text-muted font-semibold pr-3">
                    Unit
                  </th>
                  {data.weeks.map((w) => (
                    <th key={w} scope="col" className="text-xs text-muted font-normal px-1 whitespace-nowrap">
                      {short(w)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.units.map((u) => (
                  <tr key={u.unit_id}>
                    <th scope="row" className="text-left text-[13px] leading-5 font-medium text-text pr-3 whitespace-nowrap">
                      {u.unit_name}
                    </th>
                    {u.series.map((c) => {
                      const label = c.units
                        ? `${u.unit_name}, week ending ${dateLabel(c.week_end)}: ${c.mortality} deaths, ${fmt(c.mortality_pct)}%`
                        : `${u.unit_name}, week ending ${dateLabel(c.week_end)}: no fish`
                      const bin = c.units && c.mortality_pct != null ? binOf(c.mortality_pct) : -1
                      return (
                        <td key={c.week_end} className="p-0">
                          <div
                            tabIndex={0}
                            role="img"
                            aria-label={label}
                            title={label}
                            className="h-9 min-w-11 rounded focus:outline-none focus:ring-2 focus:ring-cyan"
                            style={{
                              background: bin >= 0 ? `var(--seq-${bin + 1})` : 'var(--foam)',
                            }}
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted" aria-label="Scale: mortality % per week">
            <span>Mortality % per week</span>
            {BIN_LABELS.map((l, i) => (
              <span key={l} className="inline-flex items-center gap-1">
                <span className="inline-block h-3 w-5 rounded-sm" style={{ background: `var(--seq-${i + 1})` }} aria-hidden />
                {l}
              </span>
            ))}
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-3 w-5 rounded-sm bg-surface-2 border border-line" aria-hidden />
              No fish
            </span>
          </div>
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Profitability by cycle
// ---------------------------------------------------------------------------

function Cycles({ skip, locationArgs }) {
  const { formatCurrency } = useCurrency()
  const rows = useQuery(api.analytics.cycles, skip ? 'skip' : { ...locationArgs })
  if (rows === undefined) return <Loading />
  if (!rows.length) return <NoData what="cycles" />
  // Costs and revenue come back only with permission to see finance.
  const money = rows.some((r) => 'total_cost' in r)

  const columns = [
    { key: 'unit_name', label: 'Unit' },
    { key: 'batch_number', label: 'Batch' },
    { key: 'dates', label: 'Dates', render: (r) => `${dateLabel(r.start_date)} – ${r.open ? 'open' : dateLabel(r.end_date)}` },
    { key: 'fcr', label: 'FCR', num: true, render: (r) => fmt(r.fcr) },
    { key: 'survival_pct', label: 'Survival %', num: true, render: (r) => fmt(r.survival_pct, 1) },
    { key: 'harvested_kg', label: 'Harvested kg', num: true, render: (r) => int(r.harvested_kg) },
    ...(money
      ? [
          { key: 'feed_cost', label: 'Feed', num: true, render: (r) => formatCurrency(r.feed_cost) },
          { key: 'fingerling_cost', label: 'Fingerlings', num: true, render: (r) => formatCurrency(r.fingerling_cost) },
          { key: 'other_cost', label: 'Other', num: true, render: (r) => formatCurrency(r.other_cost) },
          { key: 'revenue', label: 'Revenue', num: true, render: (r) => formatCurrency(r.revenue) },
          { key: 'cost_per_kg', label: 'Cost/kg harvested', num: true, render: (r) => (r.cost_per_kg == null ? '—' : formatCurrency(r.cost_per_kg)) },
          {
            key: 'net_margin',
            label: 'Margin',
            num: true,
            render: (r) => formatCurrency(r.net_margin),
            className: (r) => (r.net_margin < 0 ? 'text-alert' : ''),
          },
        ]
      : []),
  ]
  const chart = rows
    .filter((r) => money && !r.open)
    .slice(0, 15)
    .map((r) => ({ name: `${r.unit_name} ${r.batch_number}`.slice(0, 18), value: r.net_margin }))
    .sort((a, b) => b.value - a.value)

  const exportCsv = () =>
    downloadCsv(
      'profitability-by-cycle.csv',
      [
        'Unit', 'Site', 'Batch', 'Start', 'End', 'Open', 'FCR', 'Survival %', 'Harvested kg',
        ...(money ? ['Feed cost', 'Fingerling cost', 'Other cost', 'Revenue', 'Total cost', 'Cost per kg harvested', 'Net margin'] : []),
      ],
      rows.map((r) => [
        r.unit_name, r.site_name ?? '', r.batch_number, r.start_date, r.end_date, r.open ? 'yes' : 'no',
        r.fcr, r.survival_pct, r.harvested_kg,
        ...(money ? [r.feed_cost, r.fingerling_cost, r.other_cost, r.revenue, r.total_cost, r.cost_per_kg, r.net_margin] : []),
      ]),
    )

  return (
    <div className="space-y-6">
      {chart.length > 0 && (
        <Card>
          <CardHeader title="Net margin of closed cycles" subtitle="Latest 15 closed cycles, ranked. Losses are red, left of zero." />
          <RankedBars data={chart} format={(v) => formatCurrency(v)} label="Net margin" signed />
        </Card>
      )}
      <Card padding={false}>
        <div className="px-5 py-6 sm:px-[26px] flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold leading-[18px] text-text">{money ? 'Profitability by cycle' : 'Cycles'}</h2>
            <p className="text-[13px] leading-5 text-muted mt-1">
              {money
                ? "Feed at purchase prices; expenses and sales of the unit in the cycle's dates. Open cycles count to date."
                : 'Open cycles count to date. Costs and revenue need permission to see finance.'}
            </p>
          </div>
          <ExportButton onClick={exportCsv} />
        </div>
        <Table caption="Profitability by cycle" columns={columns} rows={rows} rowKey={(r) => `${r.unit_id}|${r.batch_number}|${r.start_date}`} />
      </Card>
    </div>
  )
}
