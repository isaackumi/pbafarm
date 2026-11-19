import { useMemo } from 'react'
import { useQuery } from 'convex/react'
import Link from 'next/link'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { KpiStrip, LoadingState, Table } from '../../components/ui'
import NavTabs from '../../components/ui/NavTabs'
import { Panel, ListRow } from '../../components/ui/Panel'
import InventoryActions from '../../components/inventory/InventoryActions'
import { inventoryTabs } from '../../lib/sectionTabs'
import { formatMass } from '../../lib/feedOverview'
import { formatNumber } from '../../lib/format'
import { SERIES, axisProps, gridProps, legendProps, tooltipProps } from '../../lib/chartTheme'
import { useT } from '../../lib/i18n/context'
import { usePermission } from '../../hooks/usePermission'
import { useMoney } from '../../lib/money'
import { useAuth } from '../../contexts/AuthContext'
import { useLocation } from '../../contexts/LocationContext'
import { api } from '../../convex/_generated/api'
import {
  LineChart,
  Line,
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
} from 'recharts'

export default function InventoryOverviewPage() {
  return (
    <ProtectedRoute>
      <InventoryOverview />
    </ProtectedRoute>
  )
}

const IN_TYPES = new Set(['purchase', 'adjustment', 'transfer'])
// The two legs of a site-to-site transfer (INV-002) cancel out company-wide.
const isTransferLeg = (t) => t.transaction_type === 'transfer_out' || t.transaction_type === 'transfer_in'

function processTransactionData(data) {
  const grouped = data.filter((t) => !isTransferLeg(t)).reduce((acc, item) => {
    const date = new Date(item.transaction_date).toLocaleDateString()
    if (!acc[date]) acc[date] = { in: 0, out: 0 }
    const qty = Math.abs(item.quantity_kg || 0)
    if (IN_TYPES.has(item.transaction_type) && (item.quantity_kg || 0) >= 0) {
      acc[date].in += qty
    } else {
      acc[date].out += qty
    }
    return acc
  }, {})

  return Object.entries(grouped).map(([date, values]) => ({
    date,
    ...values,
  }))
}

function processCategoryData(data) {
  const total = data.reduce((sum, item) => sum + (item.stock_value || 0), 0)
  if (total <= 0) {
    return [{ name: 'Feed stock', value: 0 }]
  }
  return [{ name: 'Feed stock', value: total }]
}

function processTrendData(data) {
  const grouped = data.reduce((acc, item) => {
    const date = new Date(item.transaction_date).toLocaleDateString()
    if (!acc[date]) acc[date] = 0
    acc[date] += item.quantity_kg || 0
    return acc
  }, {})

  return Object.entries(grouped).map(([date, value]) => ({
    date,
    value,
  }))
}

function InventoryOverview() {
  const { user } = useAuth()
  const t = useT()
  const money = useMoney()
  const canPurchase = usePermission('inventory.purchase.record')
  const dateFrom = useMemo(() => Date.now() - 30 * 24 * 60 * 60 * 1000, [])

  // The header site (FARM-003): stock and movements at that site.
  const { locationArgs, activeLocation } = useLocation()
  const inventoryItems = useQuery(
    api.inventory.listStockLevels,
    user ? locationArgs : 'skip',
  )
  const transactions = useQuery(
    api.inventory.listTransactions,
    user ? { dateFrom, limit: 200, ...locationArgs } : 'skip',
  )

  const loading = inventoryItems === undefined || transactions === undefined

  const metrics = useMemo(() => {
    const items = inventoryItems || []
    const txns = transactions || []
    const totalItems = items.reduce((sum, item) => sum + (item.current_stock || 0), 0)
    const totalValue = items.reduce((sum, item) => sum + (item.stock_value || 0), 0)
    const lowStockItems = items.filter((item) => item.is_low_stock).length

    return {
      totalItems,
      totalValue,
      lowStockItems,
      monthlyTransactions: txns.length,
      // Days of cover: stock on hand ÷ average daily use over the last 30 days.
      daysOfCover: (() => {
        const usedKg = txns
          .filter((t) => Number(t.quantity_kg) < 0 && t.transaction_type !== 'reversal' && !isTransferLeg(t))
          .reduce((sum, t) => sum - Number(t.quantity_kg), 0)
        const perDay = usedKg / 30
        return perDay > 0 ? Math.round(totalItems / perDay) : null
      })(),
      usedKg30: txns
        .filter((t) => Number(t.quantity_kg) < 0 && t.transaction_type !== 'reversal' && !isTransferLeg(t))
        .reduce((sum, t) => sum - Number(t.quantity_kg), 0),
    }
  }, [inventoryItems, transactions])

  const transactionData = useMemo(
    () => processTransactionData(transactions || []),
    [transactions],
  )
  const categoryData = useMemo(
    () => processCategoryData(inventoryItems || []),
    [inventoryItems],
  )
  const trendData = useMemo(
    () => processTrendData(transactions || []),
    [transactions],
  )

  const lowStock = (inventoryItems || []).filter((item) => item.is_low_stock)

  return (
    <Layout
      title={t('ops.inventory.title')}
      eyebrow={activeLocation?.name ? t('ops.feed.eyebrowAt', { site: activeLocation.name }) : t('ops.feed.title')}
      actions={<InventoryActions />}
    >
      <div className="flex flex-col gap-[28px]">
        <NavTabs tabs={inventoryTabs(t)} label={t('ops.tabs.inventory')} />
        {loading ? (
          <LoadingState label={t('ops.common.loading')} />
        ) : (
          <>
            <KpiStrip
              items={[
                { label: t('ops.stock.value'), value: money(metrics.totalValue, { decimals: 0 }), suffix: formatMass(metrics.totalItems) },
                {
                  label: t('ops.feed.lowStock'),
                  value: formatNumber(metrics.lowStockItems),
                  valueTone: metrics.lowStockItems > 0 ? 'warn' : undefined,
                },
                { label: t('ops.feed.used30d'), value: formatMass(metrics.usedKg30) },
                {
                  label: t('ops.inventory.cover'),
                  value: metrics.daysOfCover == null ? '—' : t('ops.feed.days', { count: metrics.daysOfCover }),
                  valueTone: metrics.daysOfCover != null && metrics.daysOfCover < 14 ? 'warn' : undefined,
                },
                { label: t('ops.inventory.entries30d'), value: formatNumber(metrics.monthlyTransactions) },
              ]}
            />

            <div className="grid grid-cols-1 gap-[20px] lg:grid-cols-2">
              <Panel title={t('ops.inventory.movementTrend')} titleId="io-moves" meta={t('ops.trends.last30')}>
                <div className="h-72 border-t border-line pt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={transactionData}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...axisProps} />
                      <YAxis {...axisProps} width={44} />
                      <Tooltip {...tooltipProps} />
                      <Legend {...legendProps} />
                      <Area type="monotone" dataKey="in" name={t('ops.inventory.in')} stackId="1" stroke="var(--cyan)" fill="var(--cyan-fill)" strokeWidth={2} />
                      <Area type="monotone" dataKey="out" name={t('ops.inventory.out')} stackId="1" stroke="var(--pink)" fill="var(--pink-fill)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Panel>

              <Panel title={t('ops.trends.costSplit')} titleId="io-cats" meta={t('ops.trends.stockValue')}>
                <div className="h-72 border-t border-line pt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} stroke="var(--surface)">
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

              <Panel title={t('ops.inventory.stockTrend')} titleId="io-trend" meta={t('ops.trends.last30')}>
                <div className="h-72 border-t border-line pt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendData}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...axisProps} />
                      <YAxis {...axisProps} width={44} />
                      <Tooltip {...tooltipProps} />
                      <Line type="monotone" dataKey="value" name={t('ops.col.kg')} stroke="var(--cyan)" strokeWidth={2} dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Panel>

              <Panel
                title={t('ops.trends.lowStock')}
                titleId="io-low"
                action={canPurchase ? { label: t('ops.trends.orderNow'), href: '/procurement' } : undefined}
              >
                {lowStock.length === 0 ? (
                  <p className="border-t border-line py-3 text-sm text-muted">{t('ops.feed.nothingToReorder')}</p>
                ) : (
                  lowStock.map((item) => (
                    <ListRow
                      key={item.feed_type_id}
                      dot="alert"
                      dotLabel={t('ops.feed.lowStockShort')}
                      title={item.feed_type_name}
                      sub={t('ops.feed.minKg', { amount: formatMass(item.minimum_stock) })}
                      value={formatMass(item.current_stock)}
                      valueSub={item.current_stock_bags != null ? t('ops.inventory.bags', { count: Number(item.current_stock_bags).toFixed(1) }) : undefined}
                    />
                  ))
                )}
              </Panel>
            </div>

            <Table
              title={t('ops.feed.feedTypes')}
              actions={
                <Link href="/stock-levels" className="rounded-sm text-sm text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
                  {t('ops.common.viewAll')}
                </Link>
              }
              columns={[
                { key: 'name', header: t('ops.col.name'), render: (item) => item.feed_type_name, sub: (item) => t('ops.feed.perKg', { amount: money(item.price_per_kg) }) },
                { key: 'stock', header: t('ops.col.onHand'), width: 140, align: 'right', render: (item) => formatMass(item.current_stock) },
                { key: 'value', header: t('ops.col.value'), width: 140, align: 'right', render: (item) => money(item.stock_value || 0) },
              ]}
              rows={(inventoryItems || []).slice(0, 8)}
              rowKey={(item) => item.feed_type_id}
              empty={t('ops.stock.none')}
            />
          </>
        )}
      </div>
    </Layout>
  )
}
