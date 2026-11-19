import React, { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { LayoutGrid, RotateCcw, Save, ClipboardPen, Wheat } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { api } from '../convex/_generated/api'
import QueryBoundary from './QueryBoundary'
import { useOptionalQuery } from '../hooks/useOptionalQuery'
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  DashboardSkeleton,
  GhostButton,
  GradientButton,
  KpiStrip,
  PageTitle,
  Pill,
  Segmented,
  StatusDot,
  Table,
} from './ui'
import { errorMessage } from '../lib/errorMessage'
import { formatDate, localToday } from '../lib/format'
import { useMutation, useQuery } from 'convex/react'
import DashboardInsights from './DashboardInsights'
import FarmAlerts from './FarmAlerts'
import SiteConditions from './SiteConditions'
import { usePermission, usePermissions } from '../hooks/usePermission'
import { useToast } from './Toast'
import { useSettings } from '../contexts/SettingsContext'
import { useTheme } from '../contexts/ThemeContext'
import { effectiveHomeHeader } from '../convex/lib/userPreferences'
import { HomeSkyTitle, SkyButton } from './dashboard/HomeSkyHeader'
import { useT } from '../lib/i18n/context'
import WidgetGrid, { visibleWidgets } from './dashboard/WidgetGrid'
import WidgetListEditor from './dashboard/WidgetListEditor'
import FeedingPlanWidget from './FeedingPlanWidget'
import { DEFAULT_DASHBOARD } from '../convex/lib/dashboardLayout'
import { routePermission } from '../lib/routePermissions'

const chartPlaceholder = () => <div className="h-full w-full rounded-lg bg-foam animate-pulse" />
const FeedTrendChart = dynamic(
  () => import('./charts/DashboardCharts').then((m) => m.FeedTrendChart),
  { ssr: false, loading: chartPlaceholder },
)
const MortalityBarsChart = dynamic(
  () => import('./charts/DashboardCharts').then((m) => m.MortalityBarsChart),
  { ssr: false, loading: chartPlaceholder },
)

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
  // A saved layout (mine or the organization's) wins; otherwise the client's
  // default, so a new default ships with the page, not with a backend deploy.
  const savedLayout = layout?.source === 'me' || layout?.source === 'org' ? layout.widgets : null
  const shownWidgets = visibleWidgets(savedLayout ?? DEFAULT_DASHBOARD, can)
  const [feedRange, setFeedRange] = useState('30')
  const { settings } = useSettings()
  const { theme } = useTheme()
  const sky = effectiveHomeHeader(settings.dashboard?.homeHeader, theme) === 'sky'

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
    return rows.slice(-Number(feedRange)).map((row) => {
      cumulative += row.feed
      const d = new Date(row.date)
      return {
        ...row,
        label: Number.isNaN(d.getTime())
          ? row.date
          : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        cumulative: Math.round(cumulative * 10) / 10,
      }
    })
  }, [dailyRecords, feedRange])

  const mortalityBars = useMemo(() => feedTrend.slice(-14), [feedTrend])

  const health = farmHealthScore(metrics)
  const mortalityPct = parseFloat(metrics.mortalityRate)
  const biomassKg = metrics.totalBiomass
  const biomassInT = biomassKg >= 1000
  const feedTotal = feedTrend.length ? feedTrend[feedTrend.length - 1].cumulative : 0

  const kpiItems = {
    'stat.activeUnits': {
      label: t('home.kpi.activeCages'),
      value: metrics.totalActiveCages,
      suffix: t('home.kpi.ofTotal', { count: metrics.totalCages ?? cages.length }),
      suffixTone: 'unit',
    },
    'stat.biomass': {
      label: t('home.kpi.biomass'),
      value: biomassInT ? (biomassKg / 1000).toFixed(1) : biomassKg.toLocaleString(),
      suffix: biomassInT ? 't' : 'kg',
      suffixTone: 'unit',
    },
    'stat.fcr': {
      label: t('home.kpi.fcr'),
      value: metrics.averageFCR === 'N/A' ? '—' : metrics.averageFCR,
      suffix: t('home.kpi.fcrHint'),
      suffixTone: 'unit',
    },
    'stat.mortality': {
      label: t('home.kpi.mortality'),
      value: `${metrics.mortalityRate}%`,
      valueTone: mortalityPct > 3 ? 'warn' : undefined,
    },
    'stat.adg': {
      label: t('home.kpi.adg'),
      value: metrics.avgDailyGrowth === 'N/A' ? '—' : metrics.avgDailyGrowth,
      suffix: metrics.avgDailyGrowth === 'N/A' ? undefined : 'g/day',
      suffixTone: 'unit',
    },
    'stat.feed30d': {
      label: t('home.kpi.feed30d'),
      value:
        summary?.recent_feed_usage_kg != null
          ? Number(summary.recent_feed_usage_kg).toLocaleString(undefined, { maximumFractionDigits: 0 })
          : '—',
      suffix: summary?.recent_feed_usage_kg != null ? 'kg' : undefined,
      suffixTone: 'unit',
    },
    'stat.health': {
      label: t('home.kpi.health'),
      value: health.toFixed(0),
      valueTone: health >= 75 ? 'good' : health >= 50 ? 'warn' : 'alert',
      suffix: '/ 100',
      suffixTone: 'unit',
    },
  }

  // The stat widgets render as one Paper KPI strip at the first stat's place.
  const gridWidgets = []
  const kpiCells = []
  for (const w of shownWidgets) {
    if (kpiItems[w.widget]) {
      if (!kpiCells.length) gridWidgets.push({ widget: '__kpis', size: 'full' })
      kpiCells.push({ key: w.widget, ...kpiItems[w.widget] })
    } else gridWidgets.push(w)
  }

  const statusTone = { approved: 'good', pending_approval: 'warn', rejected: 'alert' }
  const activityColumns = [
    {
      key: 'date',
      header: t('home.activity.date'),
      width: 110,
      render: (r) => <span className="text-muted tabular-nums">{formatDate(r.stocking_date || r.stockingDate)}</span>,
    },
    { key: 'type', header: t('home.activity.type'), width: 130, render: () => <Pill tone="cyan">{t('home.activity.stocking')}</Pill> },
    { key: 'unit', header: t('home.activity.unit'), render: (r) => r.cage?.name || '—' },
    {
      key: 'batch',
      header: t('home.activity.batch'),
      width: 150,
      render: (r) => <span className="text-muted">{r.batch_number || r.batchNumber || '—'}</span>,
    },
    {
      key: 'fish',
      header: t('home.activity.fish'),
      width: 130,
      align: 'right',
      render: (r) => (r.fish_count != null ? Number(r.fish_count).toLocaleString() : '—'),
    },
    {
      key: 'abw',
      header: t('home.activity.abw'),
      width: 130,
      align: 'right',
      render: (r) => (r.initial_abw != null ? `${Number(r.initial_abw).toFixed(1)} g` : '—'),
    },
    {
      key: 'status',
      header: t('home.activity.status'),
      width: 180,
      render: (r) =>
        r.status ? (
          <span className="inline-flex items-center gap-2">
            <StatusDot tone={statusTone[r.status] || 'neutral'} />
            <span className="text-muted">{t.or(`home.stockingStatus.${r.status}`, r.status)}</span>
          </span>
        ) : (
          '—'
        ),
    },
  ]

  const cardTitle = 'text-[15px] font-semibold leading-[18px] text-text'

  const widgetNodes = {
    // Over the sky panel (strip placed first) it needs its own surface to stay readable.
    __kpis: sky && gridWidgets[0]?.widget === '__kpis' ? (
      <div className="rounded-card border border-line bg-surface px-[22px] py-5 shadow-[var(--shadow-card)]">
        <KpiStrip items={kpiCells} className="py-1" />
      </div>
    ) : (
      <KpiStrip items={kpiCells} className="py-1" />
    ),
    insights: (
      <div className="flex flex-col gap-7">
        <FarmAlerts locationId={locationArgs?.locationId} />
        <DashboardInsights
          locationId={locationArgs?.locationId}
          aiEnabled={aiStatus?.enabled === true && aiStatus.canUse === true}
        />
      </div>
    ),
    'chart.feedTrend': (
      <section
        aria-labelledby="home-feed-title"
        className="flex min-h-[340px] flex-col gap-1 rounded-card border border-line bg-surface px-5 pb-[22px] pt-[26px] shadow-[var(--shadow-card)] sm:px-7"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 id="home-feed-title" className="text-[13px] leading-4 text-muted">
            {t('home.feed.title')}
          </h2>
          <Segmented
            label={t('home.feed.range')}
            value={feedRange}
            onChange={setFeedRange}
            options={[
              { value: '30', label: '30d' },
              { value: '90', label: '90d' },
            ]}
          />
        </div>
        <p className="text-[40px] font-semibold leading-[48px] tracking-[-0.035em] text-text tabular-nums sm:text-[48px] sm:leading-[56px]">
          {feedTotal >= 1000 ? (feedTotal / 1000).toFixed(1) : Math.round(feedTotal).toLocaleString()}
          <span className="text-[24px] font-medium tracking-[-0.035em] text-muted">
            {feedTotal >= 1000 ? ' t' : ' kg'}
          </span>
        </p>
        <p className="text-[13px] leading-4 text-muted">
          {t('home.feed.cumulative', { count: feedTrend.length })}
        </p>
        {feedTrend.length === 0 ? (
          <EmptyState
            title={t('home.feed.emptyTitle')}
            description={t('home.feed.emptyBody')}
            action={
              <Button href="/daily-entry" size="md">
                {t('home.logDaily')}
              </Button>
            }
          />
        ) : (
          <div className="flex min-h-[168px] grow flex-col pt-[14px]">
            <div className="h-[154px] grow">
              <FeedTrendChart feedTrend={feedTrend} name={t('home.feed.series')} />
            </div>
          </div>
        )}
      </section>
    ),
    'chart.mortality': (
      <Card padding={false} className="min-h-[340px] px-5 pb-5 pt-[26px] sm:px-6">
        <h2 className={cardTitle}>{t('home.mortality.title')}</h2>
        <p className="mb-[14px] mt-1 text-xs leading-4 text-muted">{t('home.mortality.subtitle')}</p>
        {mortalityBars.length === 0 ? (
          <EmptyState title={t('home.mortality.emptyTitle')} description={t('home.mortality.emptyBody')} />
        ) : (
          <div className="h-64">
            <MortalityBarsChart mortalityBars={mortalityBars} />
          </div>
        )}
      </Card>
    ),
    siteConditions: (
      <SiteConditions locationId={activeLocationId || undefined} isAdmin={canManageSites} />
    ),
    recentActivity: (
      <Table
        title={t('home.activity.title')}
        columns={activityColumns}
        rows={recentStockings.slice(0, 8)}
        empty={t('home.activity.empty')}
        actions={
          <Button href="/stocking-management" variant="ghost" size="sm" className="!min-h-0 text-[13px] text-muted">
            {t('home.activity.open')}
          </Button>
        }
      />
    ),
    feedingPlan: <FeedingPlanWidget locationId={locationArgs?.locationId} />,
  }

  if (loading) {
    return <DashboardSkeleton />
  }

  const hour = new Date().getHours()
  const firstName = (user?.name || '').trim().split(/\s+/)[0]
  const greeting = firstName
    ? t(`home.greeting.${hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening'}`, { name: firstName })
    : t('home.greeting.anon')

  const eyebrow = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
  const canCustomize = canReports && !customizing
  const canLogDaily = can(routePermission('/daily-entry'))
  const canIssueFeed = can(routePermission('/feed-issue'))

  return (
    <div className={`flex max-w-[1400px] flex-col gap-7 ${sky ? 'relative isolate' : ''}`}>
      {sky ? (
        <HomeSkyTitle
          eyebrow={eyebrow}
          title={greeting}
          actions={
            canCustomize || canLogDaily || canIssueFeed ? (
              <>
                {canCustomize && (
                  <SkyButton size="sm" icon={LayoutGrid} onClick={() => setCustomizing(true)}>
                    {t('dashboardLayout.customize')}
                  </SkyButton>
                )}
                {canLogDaily && (
                  <SkyButton href="/daily-entry" tone="lime" icon={ClipboardPen}>
                    {t('home.logDaily')}
                  </SkyButton>
                )}
                {canIssueFeed && (
                  <SkyButton href="/feed-issue" icon={Wheat}>
                    {t('home.issueFeed')}
                  </SkyButton>
                )}
              </>
            ) : null
          }
        />
      ) : (
        <PageTitle
          eyebrow={eyebrow}
          title={greeting}
          actions={
            <>
              {canCustomize && (
                <GhostButton size="lg" icon={LayoutGrid} onClick={() => setCustomizing(true)}>
                  {t('dashboardLayout.customize')}
                </GhostButton>
              )}
              {canLogDaily && (
                <GradientButton href="/daily-entry" icon={ClipboardPen}>
                  {t('home.logDaily')}
                </GradientButton>
              )}
              {canIssueFeed && (
                <GradientButton href="/feed-issue" reverse icon={Wheat}>
                  {t('home.issueFeed')}
                </GradientButton>
              )}
            </>
          }
        />
      )}

      {customizing && (
        <DashboardCustomizer
          layout={layout}
          canManageOrg={canManageOrg}
          can={can}
          onClose={() => setCustomizing(false)}
        />
      )}

      <WidgetGrid widgets={gridWidgets} nodes={widgetNodes} />
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
