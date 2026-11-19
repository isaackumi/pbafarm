import React, { useState } from 'react'
import Layout from '../../components/Layout'
import ProtectedRoute from '../../components/ProtectedRoute'
import { KpiStrip, Select, LoadingState } from '../../components/ui'
import NavTabs from '../../components/ui/NavTabs'
import { Panel, ListRow } from '../../components/ui/Panel'
import {
  useFeedCostAnalysis,
  useFeedUsageStats,
  useLowStockAlerts,
} from '../../hooks/useFeedData'
import { useMoney } from '../../lib/money'
import { feedTabs } from '../../lib/sectionTabs'
import { formatMass } from '../../lib/feedOverview'
import { formatNumber } from '../../lib/format'
import { useT } from '../../lib/i18n/context'

const FeedAnalytics = () => {
  const t = useT()
  const [timeRange, setTimeRange] = useState('30d')
  return (
    <ProtectedRoute>
      <Layout
        title={t('ops.feedAnalytics.title')}
        eyebrow={t('ops.feedAnalytics.eyebrow')}
        actions={
          <Select
            aria-label={t('ops.common.timeRange')}
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="w-auto"
          >
            <option value="7d">{t('ops.range.7d')}</option>
            <option value="30d">{t('ops.range.30d')}</option>
            <option value="90d">{t('ops.range.90d')}</option>
            <option value="1y">{t('ops.range.1y')}</option>
          </Select>
        }
      >
        <FeedAnalyticsBody timeRange={timeRange} />
      </Layout>
    </ProtectedRoute>
  )
}

function UsageList({ entries, empty }) {
  const max = Math.max(1, ...entries.map(([, v]) => v))
  if (entries.length === 0) return <p className="border-t border-line py-3 text-sm text-muted">{empty}</p>
  return entries.map(([name, usage]) => (
    <div key={name} className="flex items-center gap-4 border-t border-line py-3">
      <span className="w-[170px] shrink-0 truncate text-sm leading-[18px] text-text">{name}</span>
      <div className="h-2 grow overflow-hidden rounded-pill bg-line" aria-hidden>
        <div className="h-full rounded-pill" style={{ width: `${(usage / max) * 100}%`, backgroundImage: 'var(--gradient-bar)' }} />
      </div>
      <span className="w-[80px] shrink-0 text-right text-sm font-medium tabular-nums text-text">{formatMass(usage)}</span>
    </div>
  ))
}

function FeedAnalyticsBody({ timeRange }) {
  const t = useT()
  const money = useMoney()
  const usageStats = useFeedUsageStats(timeRange)
  const costAnalysis = useFeedCostAnalysis(timeRange)
  const lowStockAlerts = useLowStockAlerts()
  const loading =
    usageStats === undefined ||
    costAnalysis === undefined ||
    lowStockAlerts === undefined
  const alerts = lowStockAlerts || []
  const sorted = (obj) => Object.entries(obj || {}).sort((a, b) => b[1] - a[1])

  return (
    <div className="flex flex-col gap-[28px]">
      <NavTabs tabs={feedTabs(t)} label={t('ops.tabs.feed')} />
      {loading ? (
        <LoadingState label={t('ops.common.loading')} />
      ) : (
        <>
          <KpiStrip
            items={[
              { label: t('ops.feedAnalytics.totalUsage'), value: formatMass(usageStats?.totalUsage || 0) },
              { label: t('ops.feedAnalytics.purchased'), value: money(costAnalysis?.totalCost || 0, { decimals: 0 }) },
              { label: t('ops.feedAnalytics.avgCost'), value: money(costAnalysis?.averageCostPerKg || 0), suffix: '/ kg' },
              {
                label: t('ops.feed.lowStock'),
                value: formatNumber(alerts.length),
                valueTone: alerts.length > 0 ? 'warn' : undefined,
              },
            ]}
          />

          {alerts.length > 0 && (
            <Panel title={t('ops.trends.lowStock')} titleId="fa-low">
              {alerts.map((alert, index) => (
                <ListRow
                  key={alert.id || index}
                  dot="alert"
                  dotLabel={t('ops.feed.lowStockShort')}
                  title={alert.name}
                  sub={t('ops.feed.minKg', { amount: formatMass(alert.minimumStock) })}
                  value={formatMass(alert.currentStock)}
                />
              ))}
            </Panel>
          )}

          <div className="grid grid-cols-1 gap-[20px] lg:grid-cols-2">
            <Panel title={t('ops.feedAnalytics.byFeed')} titleId="fa-feed">
              <UsageList entries={sorted(usageStats?.byFeedType)} empty={t('ops.feedAnalytics.noUsage')} />
            </Panel>
            <Panel title={t('ops.feedAnalytics.byCage')} titleId="fa-cage">
              <UsageList entries={sorted(usageStats?.byCage)} empty={t('ops.feedAnalytics.noUsage')} />
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}

export default FeedAnalytics
