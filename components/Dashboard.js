import React, { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'
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
import {
  Fish,
  Scales,
  ChartLineUp,
  Warning,
  CalendarBlank,
  Plus,
  Package,
  ArrowRight,
} from '@phosphor-icons/react'
import { useAuth } from '../contexts/AuthContext'
import {
  cageService,
  stockingService,
} from '../lib/databaseService'
import { getConvexHttpClient, api } from '../lib/convexBridge'
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
  const [cages, setCages] = useState([])
  const [dailyRecords, setDailyRecords] = useState([])
  const [recentStockings, setRecentStockings] = useState([])
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [tableTab, setTableTab] = useState('stockings')
  const [metrics, setMetrics] = useState({
    totalActiveCages: 0,
    totalBiomass: 0,
    averageFCR: 'N/A',
    mortalityRate: '0.0',
    avgDailyGrowth: 'N/A',
    feedCostPerKg: 'N/A',
    activeFish: 0,
  })

  const firstName =
    (user?.name || user?.email || 'there').split(' ')[0] || 'there'

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
        let biomass = 0
        active.forEach((cage) => {
          const cageId = cage.id || cage._id
          const stocking = sorted.find(
            (s) => (s.cage_id || s.cageId) === cageId,
          )
          if (stocking) biomass += Number(stocking.initial_biomass || 0)
        })

        const client = getConvexHttpClient()
        const [kpis, dashSummary, daily] = await Promise.all([
          client.query(api.reports.dashboardKpis, { dateRange: 30 }).catch(() => null),
          client.query(api.reports.dashboardSummary, { dateRange: 30 }).catch(() => null),
          client.query(api.dailyRecords.list, {}).catch(() => []),
        ])
        if (cancelled) return

        setDailyRecords(daily || [])
        setSummary(dashSummary)

        setMetrics({
          totalActiveCages: active.length,
          totalBiomass: Math.round(biomass),
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
          activeFish: kpis?.active_fish_count ?? dashSummary?.active_fish_count ?? 0,
        })
      } catch (err) {
        if (!cancelled) setError(err.message || String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

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

  return (
    <div className="space-y-6 max-w-[1400px]">
      {error && (
        <div className="rounded-xl border border-signal/30 bg-signal/10 px-4 py-3 text-sm text-signal">
          {error}
        </div>
      )}

      {/* Hero row */}
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-muted">Operations overview</p>
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-chart-ink tracking-tight mt-1">
            Welcome back, {firstName}
          </h1>
          <p className="text-muted mt-1 text-base">
            {metrics.totalActiveCages} active cages ·{' '}
            {Number(metrics.activeFish).toLocaleString()} fish on farm
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button href="/daily-entry" size="lg">
            <CalendarBlank size={22} weight="bold" />
            Log daily entry
          </Button>
          <Button href="/stocking" variant="secondary" size="lg">
            <Plus size={22} weight="bold" />
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
          hint={`${summary?.cages?.total ?? cages.length} total cages`}
        />
        <StatCard
          label="Stocked biomass"
          value={metrics.totalBiomass.toLocaleString()}
          unit="kg"
          icon={Package}
          tone="accent"
        />
        <StatCard
          label="Avg FCR"
          value={metrics.averageFCR}
          icon={Scales}
          hint="From harvest records (30d)"
        />
        <StatCard
          label="Mortality"
          value={metrics.mortalityRate}
          unit="%"
          icon={Warning}
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
            </div>
          )}
        </Card>
      </div>

      {/* Recent activity */}
      <Card padding={false}>
        <div className="p-5 sm:p-6 border-b border-foam-deep flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-chart-ink">
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
                  <tr className="text-left text-xs uppercase tracking-wide text-muted bg-foam/60">
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
                            <ArrowRight size={16} weight="bold" />
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
                icon={ChartLineUp}
                tone="accent"
              />
              <StatCard
                label="Feed cost / harvest kg"
                value={metrics.feedCostPerKg}
                unit={metrics.feedCostPerKg === 'N/A' ? '' : ''}
                icon={Scales}
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
