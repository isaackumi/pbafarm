import { useMemo } from 'react'
import { useQuery } from 'convex/react'
import {
  Package,
  BarChart2,
  ShoppingCart,
  Scale,
} from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { PageHeader, StatCard, Button, LoadingState } from '../../components/ui'
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
import { localToday } from '../../lib/format'
import { useLocation } from '../../contexts/LocationContext'

export default function FeedManagementOverviewPage() {
  return (
    <ProtectedRoute>
      <FeedManagementOverview />
    </ProtectedRoute>
  )
}

function FeedManagementOverview() {
  const money = useMoney()
  const kg = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })

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

  const COLORS = ['var(--lake)', 'var(--kelp)', '#d97706', 'var(--signal)', 'var(--muted)']

  const {
    feedTypes = [],
    metrics = {},
    usageData = [],
    costData = [],
    supplierData = [],
  } = view || {}

  return (
    <Layout title="Feed Management Overview">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Feed management' },
          { label: 'Overview' },
        ]}
        description="Feed stock, purchases, and usage at a glance."
        related={[
          { label: 'Feed purchases', href: '/feed-purchases' },
          { label: 'Feed types', href: '/feed-types' },
          { label: 'Feed suppliers', href: '/feed-suppliers' },
          { label: 'Stock levels', href: '/stock-levels' },
        ]}
      />

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Button href="/feed-purchases" variant="secondary" className="w-full">
            <ShoppingCart className="w-4 h-4" aria-hidden />
            Record purchase
          </Button>
          <Button href="/feed-issue" variant="secondary" className="w-full">
            <Scale className="w-4 h-4" aria-hidden />
            Issue feed
          </Button>
          <Button href="/feed-types" variant="secondary" className="w-full">
            <Package className="w-4 h-4" aria-hidden />
            Feed types
          </Button>
          <Button href="/feed-suppliers" variant="secondary" className="w-full">
            <BarChart2 className="w-4 h-4" aria-hidden />
            Suppliers
          </Button>
        </div>

        {loading ? (
          <LoadingState label="Loading feed data..." />
        ) : (
        <>
        {/* Key Metrics */}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          <StatCard label="Feed in stock" value={kg(metrics.totalStock)} unit="kg" />
          <StatCard label="Stock value" value={money(metrics.totalValue, { decimals: 0 })} />
          <StatCard
            label="Low stock"
            value={metrics.lowStockItems}
            unit={metrics.lowStockItems === 1 ? 'feed type' : 'feed types'}
            tone={metrics.lowStockItems > 0 ? 'warn' : 'default'}
          />
          <StatCard label="Used, last 30 days" value={kg(metrics.monthlyUsage)} unit="kg" />
          <StatCard
            label="Farm eFCR"
            value={metrics.averageFCR == null ? '—' : metrics.averageFCR.toFixed(2)}
            hint={
              metrics.averageFCR == null
                ? 'Needs stocking, feed and a bi-weekly sample'
                : 'Active cycles: feed ÷ biomass gained'
            }
            tone="accent"
          />
          <StatCard
            label="Average price in stock"
            value={metrics.feedCostPerKg == null ? '—' : money(metrics.feedCostPerKg)}
            unit={metrics.feedCostPerKg == null ? '' : 'per kg'}
          />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Feed Usage Trend */}
          <div className="page-card p-4 sm:p-6">
            <h3 className="text-lg font-medium text-chart-ink mb-4">Feed usage trend</h3>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={usageData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {feedTypes.map((type, index) => (
                    <Line
                      key={type.id}
                      type="monotone"
                      dataKey={type.name}
                      stroke={COLORS[index % COLORS.length]}
                      strokeWidth={2}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Feed Cost Distribution */}
          <div className="page-card p-4 sm:p-6">
            <h3 className="text-lg font-medium text-chart-ink mb-4">Feed cost distribution</h3>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={costData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label={({ name, percent, value }) =>
                      value > 0
                        ? `${name} ${(percent * 100).toFixed(0)}%`
                        : null
                    }
                  >
                    {costData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Supplier Distribution */}
          <div className="page-card p-4 sm:p-6">
            <h3 className="text-lg font-medium text-chart-ink mb-4">Supplier distribution</h3>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={supplierData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="value" fill="var(--lake)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Low Stock Alerts */}
          <div className="page-card p-4 sm:p-6">
            <h3 className="text-lg font-medium text-chart-ink mb-4">Low stock alerts</h3>
            <div className="space-y-4">
              {feedTypes
                .filter(type => type.current_stock <= type.minimum_stock * 1.2)
                .map(type => (
                  <div
                    key={type.id}
                    className="flex items-center justify-between gap-4 p-4 rounded-xl border border-signal/25 bg-signal/10"
                  >
                    <div>
                      <p className="font-medium text-chart-ink">{type.name}</p>
                      <p className="text-sm text-muted tabular-nums">
                        Current: {type.current_stock.toFixed(2)} kg | Minimum:{' '}
                        {type.minimum_stock.toFixed(2)} kg
                      </p>
                    </div>
                    <Button
                      href="/feed-purchases"
                      variant="ghost"
                      size="sm"
                      className="text-signal shrink-0"
                    >
                      Order now
                    </Button>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="page-card overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-foam-deep">
            <h3 className="text-lg font-medium text-chart-ink">Recent activity</h3>
          </div>
          <div className="divide-y divide-foam-deep">
            {feedTypes.slice(0, 5).map(type => (
              <div key={type.id} className="px-4 sm:px-6 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-chart-ink">{type.name}</p>
                    <p className="text-sm text-muted tabular-nums">
                      Stock: {type.current_stock.toFixed(2)} kg | Price: {money(type.price_per_kg)}/kg
                    </p>
                  </div>
                  <div className="text-sm text-muted">
                    Last updated:{' '}
                    {type.updated_at && !Number.isNaN(new Date(type.updated_at).getTime())
                      ? new Date(type.updated_at).toLocaleDateString()
                      : '—'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        </>
        )}
    </Layout>
  )
} 