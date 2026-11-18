import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import {
  Package,
  BarChart2,
  RefreshCw,
  ShoppingCart,
  Scale,
} from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { PageHeader, StatCard } from '../../components/ui'
import { useMoney } from '../../lib/money'
import { useToast } from '../../components/Toast'
import { getConvexHttpClient, api } from '../../lib/convexBridge'
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

export default function FeedManagementOverviewPage() {
  return (
    <ProtectedRoute>
      <FeedManagementOverview />
    </ProtectedRoute>
  )
}

function FeedManagementOverview() {
  const router = useRouter()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [metrics, setMetrics] = useState({
    totalStock: 0,
    totalValue: 0,
    lowStockItems: 0,
    monthlyUsage: 0,
    averageFCR: null,
    feedCostPerKg: null,
  })
  const money = useMoney()
  const kg = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })
  const [feedTypes, setFeedTypes] = useState([])
  const [usageData, setUsageData] = useState([])
  const [costData, setCostData] = useState([])
  const [supplierData, setSupplierData] = useState([])

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      const client = getConvexHttpClient()
      
      // Fetch feed types with current stock
      const feedTypesData = await client.query(api.feed.listFeedTypes, {})
      setFeedTypes(feedTypesData || [])

      // Fetch recent feed usage (last 30 days)
      const from = new Date()
      from.setDate(from.getDate() - 30)
      const dateFrom = from.toISOString().slice(0, 10)
      const [usageData, suppliers, growth] = await Promise.all([
        client.query(api.feed.listUsage, { dateFrom }),
        client.query(api.feed.listSuppliers, {}).catch(() => []),
        client.query(api.cages.growthAll, {}).catch(() => null),
      ])
      const feedName = new Map((feedTypesData || []).map((t) => [t.id || t._id, t.name]))
      const supplierName = new Map((suppliers || []).map((x) => [x.id || x._id, x.name]))
      usageData.forEach((u) => {
        u.feed_type_name = feedName.get(u.feed_type_id) || 'Other'
      })
      feedTypesData.forEach((t) => {
        t.supplier_name = supplierName.get(t.supplier_id) || 'No supplier'
      })

      // Calculate metrics
      const totalStock = feedTypesData.reduce((sum, type) => sum + (type.current_stock || 0), 0)
      const totalValue = feedTypesData.reduce((sum, type) => sum + (type.current_stock * type.price_per_kg || 0), 0)
      const lowStockItems = feedTypesData.filter(
        (type) =>
          (Number(type.minimum_stock) || 0) > 0 &&
          (Number(type.current_stock) || 0) <=
            (Number(type.minimum_stock) || 0) * 1.2,
      ).length
      const monthlyUsage = usageData.reduce((sum, usage) => sum + (usage.quantity || 0), 0)

      setMetrics({
        totalStock,
        totalValue,
        lowStockItems,
        monthlyUsage,
        averageFCR: growth?.farm_efcr ?? null,
        feedCostPerKg: totalStock > 0 ? totalValue / totalStock : null,
      })

      // Process usage data for charts
      const processedUsageData = processUsageData(usageData)
      setUsageData(processedUsageData)

      // Process cost data
      const processedCostData = processCostData(feedTypesData)
      setCostData(processedCostData)

      // Process supplier data
      const processedSupplierData = processSupplierData(feedTypesData)
      setSupplierData(processedSupplierData)

    } catch (error) {
      console.error('Error fetching data:', error)
      showToast('Could not load feed data', 'error')
    } finally {
      setLoading(false)
    }
  }

  const processUsageData = (data) => {
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

  const processCostData = (data) => {
    return data.map(type => ({
      name: type.name,
      value: type.current_stock * type.price_per_kg
    }))
  }

  const processSupplierData = (data) => {
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

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8']

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
        actions={
          <button
            onClick={fetchData}
            className="inline-flex items-center px-3 py-2 text-sm font-semibold rounded-xl text-white bg-lagoon-950 hover:bg-lagoon-800 min-h-10"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </button>
        }
      />

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Link href="/feed-purchases">
            <button
              type="button"
              className="w-full flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-lg text-white bg-lagoon-800 hover:bg-lagoon-950"
            >
              <ShoppingCart className="w-5 h-5 mr-2" />
              Record Purchase
            </button>
          </Link>
          <Link href="/feed-issue">
            <button
              type="button"
              className="w-full flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-lg text-white bg-kelp hover:opacity-90"
            >
              <Scale className="w-5 h-5 mr-2" />
              Issue feed
            </button>
          </Link>
          <Link href="/feed-types">
            <button
              type="button"
              className="w-full flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-lg text-white bg-lagoon-950 hover:bg-lagoon-800"
            >
              <Package className="w-5 h-5 mr-2" />
              Feed types
            </button>
          </Link>
          <Link href="/feed-suppliers">
            <button
              type="button"
              className="w-full flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-lg text-white bg-lagoon-800 hover:bg-lagoon-950"
            >
              <BarChart2 className="w-5 h-5 mr-2" />
              Suppliers
            </button>
          </Link>
        </div>

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
          <div className="page-card p-6">
            <h3 className="text-lg font-medium text-chart-ink mb-4">Feed Usage Trend</h3>
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
          <div className="page-card p-6">
            <h3 className="text-lg font-medium text-chart-ink mb-4">Feed Cost Distribution</h3>
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
          <div className="page-card p-6">
            <h3 className="text-lg font-medium text-chart-ink mb-4">Supplier Distribution</h3>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={supplierData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="value" fill="#8884d8" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Low Stock Alerts */}
          <div className="page-card p-6">
            <h3 className="text-lg font-medium text-chart-ink mb-4">Low Stock Alerts</h3>
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
                      <p className="text-sm text-muted">
                        Current: {type.current_stock.toFixed(2)} kg | Minimum:{' '}
                        {type.minimum_stock.toFixed(2)} kg
                      </p>
                    </div>
                    <Link href="/feed-purchases">
                      <button
                        type="button"
                        className="text-sm font-semibold text-signal hover:opacity-80 shrink-0"
                      >
                        Order Now
                      </button>
                    </Link>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="page-card overflow-hidden">
          <div className="px-6 py-4 border-b border-foam-deep">
            <h3 className="text-lg font-medium text-chart-ink">Recent Activity</h3>
          </div>
          <div className="divide-y divide-foam-deep">
            {feedTypes.slice(0, 5).map(type => (
              <div key={type.id} className="px-6 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-chart-ink">{type.name}</p>
                    <p className="text-sm text-muted">
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
    </Layout>
  )
} 