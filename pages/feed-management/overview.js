import { useMemo } from 'react'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { KpiStrip, LoadingState, Table } from '../../components/ui'
import NavTabs from '../../components/ui/NavTabs'
import { Panel, ListRow } from '../../components/ui/Panel'
import { feedTabs } from '../../lib/sectionTabs'
import { formatMass, shortDate } from '../../lib/feedOverview'
import { SERIES, axisProps, gridProps, legendProps, tooltipProps } from '../../lib/chartTheme'
import { useT } from '../../lib/i18n/context'
import { usePermission } from '../../hooks/usePermission'
import { useMoney } from '../../lib/money'
import { api } from '../../convex/_generated/api'
import { useOptionalQuery } from '../../hooks/useOptionalQuery'
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
} from 'recharts'
import { formatNumber, localToday } from '../../lib/format'
import { useLocation } from '../../contexts/LocationContext'

export default function FeedManagementOverviewPage() {
  return (
    <ProtectedRoute>
      <FeedManagementOverview />
    </ProtectedRoute>
  )
}

function FeedManagementOverview() {
  const t = useT()
  const money = useMoney()
  const canPurchase = usePermission('inventory.purchase.record')

  // Stock, usage and FCR at the header site (FARM-003).
  const { activeLocationId, locationArgs } = useLocation()
  const dateFrom = useMemo(() => {
    const from = new Date()
    from.setDate(from.getDate() - 30)
    return from.toISOString().slice(0, 10)
  }, [])
  const asOf = useMemo(() => localToday(), [])
  const feedTypesResult = useQuery(api.feed.listFeedTypes, {})
  const siteLevels = useQuery(
    api.inventory.listStockLevels,
    activeLocationId ? locationArgs : 'skip',
  )
  const usageResult = useQuery(api.feed.listUsage, { dateFrom, ...locationArgs })
  const suppliers = useOptionalQuery(api.feed.listSuppliers, {}, [])
  const growth = useOptionalQuery(api.cages.growthAll, { asOf, ...locationArgs }, null)

  const loading =
    feedTypesResult === undefined ||
    (activeLocationId && siteLevels === undefined) ||
    usageResult === undefined ||
    suppliers === undefined ||
    growth === undefined

  const view = useMemo(() => {
    if (loading) return null
    // At a site, stock is that site's lots plus unassigned stock.
    const atSite = siteLevels
      ? new Map(siteLevels.map((l) => [l.feed_type_id, l.current_stock]))
      : null
    const supplierName = new Map((suppliers || []).map((x) => [x.id || x._id, x.name]))
    const feedTypesData = (feedTypesResult || []).map((t) => ({
      ...t,
      current_stock: atSite ? atSite.get(t.id || t._id) ?? 0 : t.current_stock,
      supplier_name: supplierName.get(t.supplier_id) || 'No supplier',
    }))
    const feedName = new Map(feedTypesData.map((t) => [t.id || t._id, t.name]))
    const usageData = (usageResult || []).map((u) => ({
      ...u,
      feed_type_name: feedName.get(u.feed_type_id) || 'Other',
    }))

    const totalStock = feedTypesData.reduce((sum, type) => sum + (type.current_stock || 0), 0)
    const totalValue = feedTypesData.reduce((sum, type) => sum + (type.current_stock * type.price_per_kg || 0), 0)
    const lowStockItems = feedTypesData.filter(
      (type) =>
        (Number(type.minimum_stock) || 0) > 0 &&
        (Number(type.current_stock) || 0) <=
          (Number(type.minimum_stock) || 0) * 1.2,
    ).length
    const monthlyUsage = usageData.reduce((sum, usage) => sum + (usage.quantity || 0), 0)

    return {
      feedTypes: feedTypesData,
      metrics: {
        totalStock,
        totalValue,
        lowStockItems,
        monthlyUsage,
        averageFCR: growth?.farm_efcr ?? null,
        feedCostPerKg: totalStock > 0 ? totalValue / totalStock : null,
      },
      usageData: processUsageData(usageData),
      costData: processCostData(feedTypesData),
      supplierData: processSupplierData(feedTypesData),
    }
  }, [loading, siteLevels, suppliers, feedTypesResult, usageResult, growth])

  function processUsageData(data) {
    // Group by date and feed type
    const grouped = data.reduce((acc, item) => {
      const date = new Date(item.usage_date).toLocaleDateString()
      if (!acc[date]) acc[date] = {}
      const name = item.feed_type_name || 'Other'
      if (!acc[date][name]) acc[date][name] = 0
      acc[date][name] += item.quantity || 0
      return acc
    }, {})

    return Object.entries(grouped).map(([date, types]) => ({
      date,
      ...types
    }))
  }

  function processCostData(data) {
    return data.map(type => ({
      name: type.name,
      value: type.current_stock * type.price_per_kg
    }))
  }

  function processSupplierData(data) {
    const supplierMap = data.reduce((acc, type) => {
      const supplier = type.supplier_name || 'No supplier'
      if (!acc[supplier]) acc[supplier] = 0
      acc[supplier] += type.current_stock
      return acc
    }, {})

    return Object.entries(supplierMap).map(([name, value]) => ({
      name,
      value
    }))
  }


  const {
    feedTypes = [],
    metrics = {},
    usageData = [],
    costData = [],
    supplierData = [],
  } = view || {}
  const lowStock = feedTypes.filter((type) => type.current_stock <= type.minimum_stock * 1.2)

  return (
    <Layout title={t('ops.trends.title')} eyebrow={t('ops.trends.eyebrow')}>
      <div className="flex flex-col gap-[28px]">
        <NavTabs tabs={feedTabs(t)} label={t('ops.tabs.feed')} />
        {loading ? (
          <LoadingState label={t('ops.common.loading')} />
        ) : (
          <>
            <KpiStrip
              items={[
                { label: t('ops.feed.inStore'), value: formatMass(metrics.totalStock) },
                { label: t('ops.stock.value'), value: money(metrics.totalValue, { decimals: 0 }) },
                {
                  label: t('ops.feed.lowStock'),
                  value: formatNumber(metrics.lowStockItems),
                  valueTone: metrics.lowStockItems > 0 ? 'warn' : undefined,
                },
                { label: t('ops.feed.used30d'), value: formatMass(metrics.monthlyUsage) },
                {
                  label: t('ops.trends.efcr'),
                  value: metrics.averageFCR == null ? '—' : metrics.averageFCR.toFixed(2),
                },
                {
                  label: t('ops.trends.avgPrice'),
                  value: metrics.feedCostPerKg == null ? '—' : money(metrics.feedCostPerKg),
                  suffix: metrics.feedCostPerKg == null ? undefined : '/ kg',
                },
              ]}
            />

            <div className="grid grid-cols-1 gap-[20px] lg:grid-cols-2">
              <Panel title={t('ops.trends.usage')} titleId="fo-usage" meta={t('ops.trends.last30')}>
                <div className="h-72 border-t border-line pt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={usageData}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="date" {...axisProps} />
                      <YAxis {...axisProps} width={44} />
                      <Tooltip {...tooltipProps} />
                      <Legend {...legendProps} />
                      {feedTypes.map((type, index) => (
                        <Line key={type.id} type="monotone" dataKey={type.name} stroke={SERIES[index % SERIES.length]} strokeWidth={2} dot={false} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Panel>

              <Panel title={t('ops.trends.costSplit')} titleId="fo-cost" meta={t('ops.trends.stockValue')}>
                <div className="h-72 border-t border-line pt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={costData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={100} stroke="var(--surface)">
                        {costData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={SERIES[index % SERIES.length]} />
                        ))}
                      </Pie>
                      <Tooltip {...tooltipProps} formatter={(v) => money(v, { decimals: 0 })} />
                      <Legend {...legendProps} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </Panel>

              <Panel title={t('ops.trends.bySupplier')} titleId="fo-supplier" meta={t('ops.trends.kgInStock')}>
                <div className="h-72 border-t border-line pt-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={supplierData}>
                      <CartesianGrid {...gridProps} />
                      <XAxis dataKey="name" {...axisProps} />
                      <YAxis {...axisProps} width={44} />
                      <Tooltip {...tooltipProps} />
                      <Bar dataKey="value" name={t('ops.col.kg')} fill="var(--cyan)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Panel>

              <Panel
                title={t('ops.trends.lowStock')}
                titleId="fo-low"
                action={canPurchase ? { label: t('ops.trends.orderNow'), href: '/feed-purchases' } : undefined}
              >
                {lowStock.length === 0 ? (
                  <p className="border-t border-line py-3 text-sm text-muted">{t('ops.feed.nothingToReorder')}</p>
                ) : (
                  lowStock.map((type) => (
                    <ListRow
                      key={type.id}
                      dot={type.current_stock <= type.minimum_stock * 0.5 ? 'alert' : 'warn'}
                      dotLabel={t('ops.feed.lowStockShort')}
                      title={type.name}
                      sub={t('ops.feed.minKg', { amount: formatMass(type.minimum_stock) })}
                      value={formatMass(type.current_stock)}
                    />
                  ))
                )}
              </Panel>
            </div>

            <Table
              title={t('ops.feed.feedTypes')}
              columns={[
                { key: 'name', header: t('ops.col.name'), sub: (type) => type.supplier_name },
                { key: 'stock', header: t('ops.col.onHand'), width: 130, align: 'right', render: (type) => formatMass(type.current_stock) },
                { key: 'price', header: t('ops.col.pricePerKg'), width: 130, align: 'right', render: (type) => money(type.price_per_kg) },
                {
                  key: 'updated',
                  header: t('ops.col.updated'),
                  width: 130,
                  align: 'right',
                  render: (type) => <span className="text-muted">{type.updated_at && !Number.isNaN(new Date(type.updated_at).getTime()) ? shortDate(new Date(type.updated_at).getTime()) : '—'}</span>,
                },
              ]}
              rows={feedTypes.slice(0, 8)}
              empty={t('ops.feed.noFeedTypes')}
            />
          </>
        )}
      </div>
    </Layout>
  )
}
