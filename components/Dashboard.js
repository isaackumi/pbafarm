import React, { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import dynamic from 'next/dynamic'
import {
  ArrowRight,
  Calendar,
  Fish,
  Package,
  Plus,
  Scale,
  TrendingUp,
  TriangleAlert,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import {
  cageService,
  stockingService,
} from '../lib/databaseService'
import { getConvexHttpClient, api } from '../lib/convexBridge'
import { withActiveLocation } from '../lib/locationScope'
import { errorMessage } from '../lib/errorMessage'
import {
  Button,
  Card,
  CardHeader,
  StatCard,
  HealthMeter,
  EmptyState,
  TabBar,
  DashboardSkeleton,
} from './ui'
import { localToday } from '../lib/format'

const chartPlaceholder = () => <div className="h-full w-full rounded-lg bg-foam animate-pulse" />
const FeedTrendChart = dynamic(
  () => import('./charts/DashboardCharts').then((m) => m.FeedTrendChart),
  { ssr: false, loading: chartPlaceholder },
)
const MortalityBarsChart = dynamic(
  () => import('./charts/DashboardCharts').then((m) => m.MortalityBarsChart),
  { ssr: false, loading: chartPlaceholder },
)

function formatDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function daysOfCulture(value) {
  const start = value ? new Date(value) : null
  if (!start || Number.isNaN(start.getTime())) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  start.setHours(0, 0, 0, 0)
  return Math.floor((today - start) / (1000 * 60 * 60 * 24))
}

function farmHealthScore(metrics) {
  let score = 70
  const mort = parseFloat(metrics.mortalityRate)
  if (!Number.isNaN(mort)) {
    if (mort <= 1) score += 15
    else if (mort <= 3) score += 5
    else score -= Math.min(25, mort * 3)
  }
  const fcr = parseFloat(metrics.averageFCR)
  if (!Number.isNaN(fcr)) {
    if (fcr > 0 && fcr <= 1.4) score += 10
    else if (fcr <= 1.8) score += 4
    else score -= 8
  }
  const active = Number(metrics.totalActiveCages) || 0
  if (active > 0) score += 5
  return Math.max(5, Math.min(98, score))
}

export default function Dashboard() {
  const router = useRouter()
  const { user } = useAuth()
  const { activeLocationId, locationArgs } = useLocation()
  const [cages, setCages] = useState([])
  const [dailyRecords, setDailyRecords] = useState([])
  const [recentStockings, setRecentStockings] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [tableTab, setTableTab] = useState('stockings')
  const [metrics, setMetrics] = useState({
    totalActiveCages: 0,
    totalCages: 0,
    totalBiomass: 0,
    averageFCR: 'N/A',
    mortalityRate: '0.0',
    avgDailyGrowth: 'N/A',
    feedCostPerKg: 'N/A',
    activeFish: 0,
  })

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [{ data: cagesData, error: cagesErr }, { data: stockingsData }] =
          await Promise.all([
            cageService.getAllCages(),
            stockingService.getAllStockings(),
          ])
        if (cagesErr) throw cagesErr
        if (cancelled) return

        const cagesList = cagesData || []
        setCages(cagesList)

        const sorted = [...(stockingsData || [])].sort(
          (a, b) =>
            new Date(b.stocking_date || b.stockingDate || 0) -
            new Date(a.stocking_date || a.stockingDate || 0),
        )
        setRecentStockings(sorted)

        const active = cagesList.filter((c) => c.status === 'active')

        const client = getConvexHttpClient()
        // asOf: the period ends on the client's today (queries should not
        // read the server clock: their cache does not expire at midnight).
        const asOf = localToday()
        const scoped = withActiveLocation({ dateRange: 30, asOf })
        // The charts show the last 30 logged days, so load ~90 days of
        // records, not the company's whole daily history.
        const trendFrom = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
          .toISOString()
          .slice(0, 10)
        // No per-query fallbacks: a failed query must show the error state,
        // not a dashboard of zeros that looks like real numbers.
        // Trend and biomass come from the rollups (PLAT-002): one row per
        // unit-day and per occupancy instead of every record and event.
        const [kpis, dashSummary, series, overview] = await Promise.all([
          client.query(api.reports.dashboardKpis, scoped),
          client.query(api.reports.dashboardSummary, scoped),
          client.query(
            api.reports.dailySeries,
            withActiveLocation({ from: trendFrom, to: asOf }),
          ),
          client.query(api.reports.productionOverview, withActiveLocation({})),
        ])
        // Before the rollup backfill has run: the raw reads as before.
        const rollupsEmpty = !overview?.occupancies && active.length > 0
        const [daily, growth] = rollupsEmpty
          ? await Promise.all([
              client.query(api.dailyRecords.list, withActiveLocation({ dateFrom: trendFrom })),
              client.query(api.cages.growthAll, withActiveLocation({ asOf })),
            ])
          : [
              (series || []).map((d) => ({
                date: d.date,
                feedAmount: d.feed_kg,
                mortality: d.mortality,
              })),
              { farm_biomass_kg: overview?.biomass_kg ?? 0 },
            ]
        if (cancelled) return

        setDailyRecords(daily || [])
        setSummary(dashSummary)

        const totalActive =
          dashSummary?.cages?.active ??
          kpis?.active_cages ??
          active.length
        const totalCages = dashSummary?.cages?.total ?? cagesList.length

        setMetrics({
          totalActiveCages: totalActive,
          totalBiomass: Math.round(growth?.farm_biomass_kg ?? 0),
          averageFCR:
            kpis?.avg_fcr != null ? Number(kpis.avg_fcr).toFixed(2) : 'N/A',
          mortalityRate:
            kpis?.mortality_rate_pct != null
              ? Number(kpis.mortality_rate_pct).toFixed(1)
              : '0.0',
          avgDailyGrowth:
            kpis?.avg_daily_growth_g != null
              ? Number(kpis.avg_daily_growth_g).toFixed(1)
              : 'N/A',
          feedCostPerKg:
            kpis?.feed_cost_per_kg_harvested != null
              ? Number(kpis.feed_cost_per_kg_harvested).toFixed(2)
              : 'N/A',
          activeFish:
            kpis?.active_fish_count ??
            dashSummary?.active_fish_count ??
            0,
          totalCages,
        })
      } catch (err) {
        if (!cancelled) setError(errorMessage(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [activeLocationId, locationArgs?.locationId, reloadKey])

  const feedTrend = useMemo(() => {
    const byDate = {}
    for (const r of dailyRecords) {
      const key = r.date
      if (!key) continue
      if (!byDate[key]) byDate[key] = { date: key, feed: 0, mortality: 0 }
      byDate[key].feed += Number(r.feed_amount ?? r.feedAmount ?? 0)
      byDate[key].mortality += Number(r.mortality ?? 0)
    }
    const rows = Object.values(byDate).sort((a, b) =>
      String(a.date).localeCompare(String(b.date)),
    )
    let cumulative = 0
    return rows.slice(-30).map((row) => {
      cumulative += row.feed
      const d = new Date(row.date)
      return {
        ...row,
        label: Number.isNaN(d.getTime())
          ? row.date
          : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        cumulative: Math.round(cumulative * 10) / 10,
      }
    })
  }, [dailyRecords])

  const mortalityBars = useMemo(() => feedTrend.slice(-14), [feedTrend])

  const health = farmHealthScore(metrics)
  const mortTone =
    parseFloat(metrics.mortalityRate) > 3
      ? 'warn'
      : parseFloat(metrics.mortalityRate) <= 1.5
        ? 'good'
        : 'default'

  if (loading) {
    return <DashboardSkeleton />
  }

  if (error) {
    return (
      <div className="max-w-[1400px]">
        <Card>
          <div role="alert" className="flex flex-col items-center text-center py-6">
            <TriangleAlert className="h-8 w-8 text-signal mb-3" aria-hidden />
            <p className="font-semibold text-chart-ink">
              The dashboard could not load
            </p>
            <p className="text-sm text-muted mt-1 max-w-md">{error}</p>
            <Button className="mt-5" onClick={() => setReloadKey((k) => k + 1)}>
              Try again
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6 max-w-[1400px]">

      {/* Hero row */}
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <p className="text-sm text-muted">Farm overview</p>
          <h1 className="font-display text-[28px] sm:text-4xl font-medium text-chart-ink mt-1">
            {new Date().toLocaleDateString(undefined, {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </h1>
          <p className="text-muted mt-2 text-base tabular-nums">
            {metrics.totalActiveCages} active cages ·{' '}
            {Number(metrics.activeFish).toLocaleString()} fish on farm
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button href="/daily-entry" size="lg">
            <Calendar size={22} />
            Log daily entry
          </Button>
          <Button href="/stocking" variant="secondary" size="lg">
            <Plus size={22} />
            New stocking
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <HealthMeter score={health} label="Farm health" />
        <StatCard
          label="Active cages"
          value={metrics.totalActiveCages}
          icon={Fish}
          hint={`${metrics.totalCages ?? summary?.cages?.total ?? cages.length} total at this location`}
        />
        <StatCard
          label="Standing biomass"
          value={metrics.totalBiomass.toLocaleString()}
          unit="kg"
          icon={Package}
          tone="accent"
        />
        <StatCard
          label="Avg FCR"
          value={metrics.averageFCR}
          icon={Scale}
          hint="From harvest records (30d)"
        />
        <StatCard
          label="Mortality"
          value={metrics.mortalityRate}
          unit="%"
          icon={TriangleAlert}
          tone={mortTone}
          hint="Last 30 days"
        />
      </div>

      {/* Charts + table */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2 min-h-[22rem]">
          <CardHeader
            title="Cumulative feed"
            subtitle="Daily feed logged over the last 30 days"
          />
          {feedTrend.length === 0 ? (
            <EmptyState
              title="No feed data yet"
              description="Log daily entries to see cumulative feed usage."
              action={
                <Button href="/daily-entry" size="md">
                  Log daily entry
                </Button>
              }
            />
          ) : (
            <div className="h-64 sm:h-72">
              <FeedTrendChart feedTrend={feedTrend} />
            </div>
          )}
        </Card>

        <Card className="min-h-[22rem]">
          <CardHeader
            title="Daily mortality"
            subtitle="Last 14 logging days"
          />
          {mortalityBars.length === 0 ? (
            <EmptyState
              title="No mortality logged"
              description="Daily mortality will appear here once records exist."
            />
          ) : (
            <div className="h-64 sm:h-72">
              <MortalityBarsChart mortalityBars={mortalityBars} />
            </div>
          )}
        </Card>
      </div>

      {/* Recent activity */}
      <Card padding={false}>
        <div className="p-5 sm:p-6 border-b border-foam-deep flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-chart-ink">
              Recent activity
            </h2>
            <p className="text-sm text-muted mt-0.5">
              Stockings and growth signals
            </p>
          </div>
          <TabBar
            tabs={[
              { id: 'stockings', label: 'Recent stockings' },
              { id: 'growth', label: 'Growth' },
            ]}
            active={tableTab}
            onChange={setTableTab}
          />
        </div>

        {tableTab === 'stockings' && (
          <div className="overflow-x-auto">
            {recentStockings.length === 0 ? (
              <EmptyState
                title="No stockings yet"
                description="Create a stocking batch to track DOC and biomass."
                action={
                  <Button href="/stocking" size="md">
                    New stocking
                  </Button>
                }
              />
            ) : (
              <table className="min-w-full">
                <thead>
                  <tr className="text-left text-xs text-muted bg-foam/60">
                    <th className="px-5 py-3.5 font-semibold">Batch</th>
                    <th className="px-5 py-3.5 font-semibold">Date</th>
                    <th className="px-5 py-3.5 font-semibold">DOC</th>
                    <th className="px-5 py-3.5 font-semibold">Count</th>
                    <th className="px-5 py-3.5 font-semibold">ABW</th>
                    <th className="px-5 py-3.5 font-semibold" />
                  </tr>
                </thead>
                <tbody>
                  {recentStockings.slice(0, 8).map((row) => {
                    const id = row.id || row._id
                    const doc = daysOfCulture(row.stocking_date || row.stockingDate)
                    return (
                      <tr
                        key={id}
                        className="border-t border-foam-deep hover:bg-foam/40"
                      >
                        <td className="px-5 py-4 font-semibold text-lagoon-950">
                          {row.batch_number || row.batchNumber || '—'}
                        </td>
                        <td className="px-5 py-4 text-sm font-data text-chart-ink">
                          {formatDate(row.stocking_date || row.stockingDate)}
                        </td>
                        <td className="px-5 py-4 text-sm font-data">
                          {doc == null ? '—' : `${doc}d`}
                        </td>
                        <td className="px-5 py-4 text-sm font-data">
                          {row.fish_count != null
                            ? Number(row.fish_count).toLocaleString()
                            : '—'}
                        </td>
                        <td className="px-5 py-4 text-sm font-data">
                          {row.initial_abw != null
                            ? `${Number(row.initial_abw).toFixed(1)} g`
                            : '—'}
                        </td>
                        <td className="px-5 py-4 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => router.push('/stocking-management')}
                          >
                            Open
                            <ArrowRight size={16} />
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {tableTab === 'growth' && (
          <div className="p-5 sm:p-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard
                label="Avg daily growth"
                value={metrics.avgDailyGrowth}
                unit={metrics.avgDailyGrowth === 'N/A' ? '' : 'g/day'}
                icon={TrendingUp}
                tone="accent"
              />
              <StatCard
                label="Feed cost / harvest kg"
                value={metrics.feedCostPerKg}
                unit={metrics.feedCostPerKg === 'N/A' ? '' : ''}
                icon={Scale}
              />
              <StatCard
                label="Feed (30d)"
                value={
                  summary?.recent_feed_usage_kg != null
                    ? Number(summary.recent_feed_usage_kg).toFixed(0)
                    : '—'
                }
                unit="kg"
                icon={Package}
              />
            </div>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button href="/biweekly-entry" size="md">
                Record biweekly ABW
              </Button>
              <Button href="/report" variant="secondary" size="md">
                Production report
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
