import { useMemo, useState } from 'react'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { KpiStrip, LoadingState, Select } from '../../components/ui'
import NavTabs from '../../components/ui/NavTabs'
import { Panel } from '../../components/ui/Panel'
import { inventoryTabs } from '../../lib/sectionTabs'
import { formatMass } from '../../lib/feedOverview'
import { formatNumber } from '../../lib/format'
import { SERIES, axisProps, gridProps, legendProps, tooltipProps } from '../../lib/chartTheme'
import { useT } from '../../lib/i18n/context'
import { useMoney } from '../../lib/money'
import { api } from '../../convex/_generated/api'
import { useLocation } from '../../contexts/LocationContext'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from 'recharts'

export default function InventoryAnalyticsPage() {
  return (
    <ProtectedRoute>
      <InventoryAnalytics />
    </ProtectedRoute>
  )
}

function InventoryAnalytics() {
  const t = useT()
  const money = useMoney()
  const [timeRange, setTimeRange] = useState('30d')
  // Window fixed per range choice so the live query args stay stable.
  const range = useMemo(() => {
    const start = new Date()
    if (timeRange === '7d') start.setDate(start.getDate() - 7)
    else if (timeRange === '90d') start.setDate(start.getDate() - 90)
    else if (timeRange === '1y') start.setFullYear(start.getFullYear() - 1)
    else start.setDate(start.getDate() - 30)
    return { dateFrom: start.getTime(), dateTo: Date.now() }
  }, [timeRange])
  // Stock and movements at the header site (INV-901), like the overview page.
  const { activeLocationId, locationArgs } = useLocation()
  const itemsResult = useQuery(api.inventory.listStockLevels, locationArgs)
  const transactionsResult = useQuery(api.inventory.listTransactions, {
    ...range,
    limit: 500,
    ...locationArgs,
  })
  const loading = itemsResult === undefined || transactionsResult === undefined
  const inventoryItems = itemsResult || []

  const IN_TYPES = new Set(['purchase', 'adjustment', 'transfer', 'reversal'])
  const OUT_TYPES = new Set(['usage', 'issue', 'daily_usage'])

  const qtyKg = (item) => Number(item.quantity_kg ?? item.quantity ?? 0)

  const processTransactionData = (data) => {
    // Transfer legs (INV-002) move stock between sites; company-wide they net
    // to zero, but at one site they are real movements in or out.
    const moves = (data || []).filter(
      (t) =>
        activeLocationId ||
        (t.transaction_type !== 'transfer_out' && t.transaction_type !== 'transfer_in'),
    )
    const grouped = moves.reduce((acc, item) => {
      const date = new Date(item.transaction_date).toLocaleDateString()
      if (!acc[date]) acc[date] = { in: 0, out: 0 }
      const type = item.transaction_type
      const qty = Math.abs(qtyKg(item))
      if (OUT_TYPES.has(type) || qtyKg(item) < 0) {
        acc[date].out += qty
      } else if (IN_TYPES.has(type) || type === 'purchase') {
        acc[date].in += qty
      } else {
        acc[date].in += qty
      }
      return acc
    }, {})

    return Object.entries(grouped).map(([date, values]) => ({
      date,
      ...values,
    }))
  }

  const processCategoryData = (data) => {
    const rows = (data || []).map((item) => ({
      name: item.feed_type_name || 'Feed',
      value: Number(item.stock_value ?? 0),
    }))
    const withValue = rows.filter((r) => r.value > 0)
    return withValue.length ? withValue : [{ name: 'No stock value', value: 0 }]
  }

  const processTrendData = (data) => {
    const grouped = (data || []).reduce((acc, item) => {
      const date = new Date(item.transaction_date).toLocaleDateString()
      if (!acc[date]) acc[date] = 0
      const type = item.transaction_type
      const qty = qtyKg(item)
      if (OUT_TYPES.has(type)) {
        acc[date] -= Math.abs(qty)
      } else if (type === 'purchase') {
        acc[date] += Math.abs(qty)
      } else {
        acc[date] += qty
      }
      return acc
    }, {})

    return Object.entries(grouped).map(([date, value]) => ({
      date,
      value,
    }))
  }

  const transactionData = processTransactionData(transactionsResult)
  const categoryData = processCategoryData(itemsResult)
  const trendData = processTrendData(transactionsResult)

  const onHandKg = inventoryItems.reduce((sum, item) => sum + Number(item.current_stock || 0), 0)
  const lowCount = inventoryItems.filter((i) => i.is_low_stock).length

  return (
    <Layout
      title={t('ops.inventory.title')}
      eyebrow={t('ops.invAnalytics.eyebrow')}
      actions={
        <Select
          aria-label={t('ops.common.timeRange')}
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value)}
          className="w-auto"
        >
          {['7d', '30d', '90d', '1y'].map((r) => (
            <option key={r} value={r}>
              {t(`ops.range.${r}`)}
            </option>
          ))}
        </Select>
      }
    >
      <div className="flex flex-col gap-[28px]">
        <NavTabs tabs={inventoryTabs(t)} label={t('ops.tabs.inventory')} />
        {loading ? (
          <LoadingState label={t('ops.common.loading')} />
        ) : (
          <>
            <KpiStrip
              items={[
                { label: t('ops.invAnalytics.feedTypes'), value: formatNumber(inventoryItems.length) },
                {
                  label: t('ops.trends.stockValue'),
                  value: money(
                    inventoryItems.reduce((sum, item) => sum + Number(item.stock_value || 0), 0),
                    { decimals: 0 },
                  ),
                },
                { label: t('ops.feed.lowStock'), value: formatNumber(lowCount), valueTone: lowCount ? 'warn' : undefined },
                { label: t('ops.stock.onHand'), value: formatMass(onHandKg) },
              ]}
            />
            <Panel title={t('ops.invAnalytics.transactions')} meta={t(`ops.range.${timeRange}`)}>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={transactionData}>
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="date" {...axisProps} />
                    <YAxis {...axisProps} />
                    <Tooltip {...tooltipProps} />
                    <Legend {...legendProps} />
                    <Area type="monotone" dataKey="in" name={t('ops.inventory.in')} stackId="1" stroke={SERIES[0]} fill="var(--cyan-fill)" />
                    <Area type="monotone" dataKey="out" name={t('ops.inventory.out')} stackId="1" stroke={SERIES[1]} fill="var(--pink-fill)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Panel>
            <div className="grid grid-cols-1 gap-[28px] lg:grid-cols-2">
              <Panel title={t('ops.invAnalytics.categories')}>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categoryData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={96}
                        stroke="var(--surface)"
                      >
                        {categoryData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={SERIES[index % SERIES.length]} />
                        ))}
                      </Pie>
                      <Tooltip {...tooltipProps} />
                      <Legend {...legendProps} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
              <Panel title={t('ops.inventory.stockTrend')}>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...axisProps} />
                      <YAxis {...axisProps} />
                      <Tooltip {...tooltipProps} />
                      <Line type="monotone" dataKey="value" name={t('ops.col.kg')} stroke={SERIES[0]} strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            </div>
          </>
        )}
      </div>
    </Layout>
  )
} 