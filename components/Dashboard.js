import React, { useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import dynamic from 'next/dynamic'
import {
  ArrowRight,
  LayoutGrid,
  RotateCcw,
  Save,
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
import { api } from '../convex/_generated/api'
import QueryBoundary from './QueryBoundary'
import { useOptionalQuery } from '../hooks/useOptionalQuery'
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
import { errorMessage } from '../lib/errorMessage'
import { localToday } from '../lib/format'
import { useMutation, useQuery } from 'convex/react'
import DashboardInsights from './DashboardInsights'
import FarmAlerts from './FarmAlerts'
import SiteConditions from './SiteConditions'
import { usePermission, usePermissions } from '../hooks/usePermission'
import { useToast } from './Toast'
import { useT } from '../lib/i18n/context'
import WidgetGrid, { visibleWidgets } from './dashboard/WidgetGrid'
import WidgetListEditor from './dashboard/WidgetListEditor'
import FeedingPlanWidget from './FeedingPlanWidget'
import { DEFAULT_DASHBOARD } from '../convex/lib/dashboardLayout'

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
  return (
    <QueryBoundary title="The dashboard could not load">
      <DashboardView />
    </QueryBoundary>
  )
}

function DashboardView() {
  const router = useRouter()
  const { user } = useAuth()
  const canManageSites = usePermission('org.sites.manage')
  const { activeLocationId, locationArgs } = useLocation()
  const aiStatus = useQuery(api.companies.aiAssistantStatus, user ? {} : 'skip')
  const t = useT()
  const { can } = usePermissions()
  const canReports = can('reports.view')
  const canManageOrg = can('customization.manage')
  const layout = useQuery(api.dashboardLayouts.get, user && canReports ? { key: 'home' } : 'skip')
  const [customizing, setCustomizing] = useState(false)
  const shownWidgets = visibleWidgets(layout?.widgets ?? DEFAULT_DASHBOARD, can)
  const [tableTab, setTableTab] = useState('stockings')

  // asOf: the period ends on the client's today (queries should not
  // read the server clock: their cache does not expire at midnight).
  const asOf = useMemo(() => localToday(), [])
  // The charts show the last 30 logged days, so load ~90 days of
  // records, not the company's whole daily history.
  const trendFrom = useMemo(
    () => new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    [],
  )
  // No per-query fallbacks: a failed query shows the error state (QueryBoundary),
  // not a dashboard of zeros that looks like real numbers.
  // Trend and biomass come from the rollups (PLAT-002): one row per
  // unit-day and per occupancy instead of every record and event.
  const cagesData = useQuery(api.cages.list, locationArgs)
  const stockingsData = useOptionalQuery(api.stocking.listStockingHistory, locationArgs, [])
  const kpis = useQuery(api.reports.dashboardKpis, { ...locationArgs, dateRange: 30, asOf })
  const summary = useQuery(api.reports.dashboardSummary, { ...locationArgs, dateRange: 30, asOf })
  const series = useQuery(api.reports.dailySeries, { ...locationArgs, from: trendFrom, to: asOf })
  const overview = useQuery(api.reports.productionOverview, locationArgs)

  const cages = cagesData || []
  const active = cages.filter((c) => c.status === 'active')
  // Before the rollup backfill has run: the raw reads as before.
  const rollupsEmpty =
    overview !== undefined && cagesData !== undefined && !overview?.occupancies && active.length > 0
  const rawDaily = useQuery(
    api.dailyRecords.list,
    rollupsEmpty ? { ...locationArgs, dateFrom: trendFrom } : 'skip',
  )
  const rawGrowth = useQuery(api.cages.growthAll, rollupsEmpty ? { ...locationArgs, asOf } : 'skip')

  const loading =
    [cagesData, stockingsData, kpis, summary, series, overview].some((r) => r === undefined) ||
    (rollupsEmpty && (rawDaily === undefined || rawGrowth === undefined))

  const recentStockings = useMemo(
    () =>
      [...(stockingsData || [])].sort(
        (a, b) =>
          new Date(b.stocking_date || b.stockingDate || 0) -
          new Date(a.stocking_date || a.stockingDate || 0),
      ),
    [stockingsData],
  )

  const dailyRecords = useMemo(() => {
    if (rollupsEmpty) return rawDaily || []
    return (series || []).map((d) => ({
      date: d.date,
      feedAmount: d.feed_kg,
      mortality: d.mortality,
    }))
  }, [rollupsEmpty, rawDaily, series])

  const growth = rollupsEmpty ? rawGrowth : { farm_biomass_kg: overview?.biomass_kg ?? 0 }
  const metrics = {
    totalActiveCages: summary?.cages?.active ?? kpis?.active_cages ?? active.length,
    totalBiomass: Math.round(growth?.farm_biomass_kg ?? 0),
    averageFCR: kpis?.avg_fcr != null ? Number(kpis.avg_fcr).toFixed(2) : 'N/A',
    mortalityRate:
      kpis?.mortality_rate_pct != null ? Number(kpis.mortality_rate_pct).toFixed(1) : '0.0',
    avgDailyGrowth:
      kpis?.avg_daily_growth_g != null ? Number(kpis.avg_daily_growth_g).toFixed(1) : 'N/A',
    feedCostPerKg:
      kpis?.feed_cost_per_kg_harvested != null
        ? Number(kpis.feed_cost_per_kg_harvested).toFixed(2)
        : 'N/A',
    activeFish: kpis?.active_fish_count ?? summary?.active_fish_count ?? 0,
    totalCages: summary?.cages?.total ?? cages.length,
  }

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

  const widgetNodes = {
    'stat.health': (
      <HealthMeter score={health} label="Farm health" />
    ),
    'stat.activeUnits': (
      <StatCard
        label="Active cages"
        value={metrics.totalActiveCages}
        icon={Fish}
        hint={`${metrics.totalCages ?? summary?.cages?.total ?? cages.length} total at this location`}
      />
    ),
    'stat.biomass': (
      <StatCard
        label="Standing biomass"
        value={metrics.totalBiomass.toLocaleString()}
        unit="kg"
        icon={Package}
        tone="accent"
      />
    ),
    'stat.fcr': (
      <StatCard
        label="Avg FCR"
        value={metrics.averageFCR}
        icon={Scale}
        hint="From harvest records (30d)"
      />
    ),
    'stat.mortality': (
      <StatCard
        label="Mortality"
        value={metrics.mortalityRate}
        unit="%"
        icon={TriangleAlert}
        tone={mortTone}
        hint="Last 30 days"
      />
    ),
    'stat.adg': (
      <StatCard
        label="Avg daily growth"
        value={metrics.avgDailyGrowth}
        unit={metrics.avgDailyGrowth === 'N/A' ? '' : 'g/day'}
        icon={TrendingUp}
        tone="accent"
      />
    ),
    'stat.feed30d': (
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
    ),
    'insights': (
      <div className="space-y-4">
        <FarmAlerts locationId={locationArgs?.locationId} />
        <DashboardInsights
          locationId={locationArgs?.locationId}
          aiEnabled={aiStatus?.enabled === true && aiStatus.canUse === true}
        />
      </div>
    ),
    'chart.feedTrend': (
      <Card className="min-h-[22rem]">
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
    ),
    'chart.mortality': (
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
    ),
    'siteConditions': (
      <SiteConditions
        locationId={activeLocationId || undefined}
        isAdmin={canManageSites}
      />
    ),
    'recentActivity': (
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
    ),
    feedingPlan: <FeedingPlanWidget locationId={locationArgs?.locationId} />,
  }

  if (loading) {
    return <DashboardSkeleton />
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
          {canReports && !customizing && (
            <Button variant="ghost" size="lg" onClick={() => setCustomizing(true)}>
              <LayoutGrid size={22} />
              {t('dashboardLayout.customize')}
            </Button>
          )}
        </div>
      </div>

      {customizing && (
        <DashboardCustomizer
          layout={layout}
          canManageOrg={canManageOrg}
          can={can}
          onClose={() => setCustomizing(false)}
        />
      )}

      <WidgetGrid widgets={shownWidgets} nodes={widgetNodes} />
    </div>
  )
}

/** Arrange this dashboard (CUSTOM-005): for me, or as the organization default. */
function DashboardCustomizer({ layout, canManageOrg, can, onClose }) {
  const t = useT()
  const { showToast } = useToast()
  const save = useMutation(api.dashboardLayouts.save)
  const reset = useMutation(api.dashboardLayouts.reset)
  const [draft, setDraft] = useState(() => visibleWidgets(layout?.widgets ?? DEFAULT_DASHBOARD, can))
  const [busy, setBusy] = useState(false)
  const run = async (fn, done) => {
    setBusy(true)
    try {
      await fn()
      showToast('success', done)
      onClose()
    } catch (err) {
      showToast('error', errorMessage(err, t('dashboardLayout.saveFailed')))
    } finally {
      setBusy(false)
    }
  }
  const sourceText =
    layout?.source === 'me'
      ? t('dashboardLayout.sourceMe')
      : layout?.source === 'org'
        ? t('dashboardLayout.sourceOrg')
        : t('dashboardLayout.sourceDefault')
  return (
    <Card className="space-y-4">
      <CardHeader title={t('dashboardLayout.customizeTitle')} subtitle={sourceText} />
      <WidgetListEditor widgets={draft} onChange={setDraft} can={can} />
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => run(() => save({ key: 'home', scope: 'me', widgets: draft }), t('dashboardLayout.savedMine'))}>
          <Save className="h-4 w-4" aria-hidden />
          {t('dashboardLayout.saveMine')}
        </Button>
        {canManageOrg && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => run(() => save({ key: 'home', scope: 'org', widgets: draft }), t('dashboardLayout.savedOrg'))}
          >
            {t('dashboardLayout.saveOrg')}
          </Button>
        )}
        {layout?.source === 'me' && (
          <Button variant="ghost" disabled={busy} onClick={() => run(() => reset({ key: 'home', scope: 'me' }), t('dashboardLayout.resetDone'))}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            {t('dashboardLayout.resetMine')}
          </Button>
        )}
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </div>
    </Card>
  )
}
