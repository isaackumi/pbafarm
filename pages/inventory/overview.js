import { useMemo } from 'react'
import Link from 'next/link'
import { useQuery } from 'convex/react'
import {
  Package,
  TrendingUp,
  AlertTriangle,
  DollarSign,
  BarChart2,
  Calendar,
  ShoppingCart,
  ArrowUp,
  ArrowDown,
} from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { PageHeader } from '../../components/ui'
import { useAuth } from '../../contexts/AuthContext'
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

function processTransactionData(data) {
  const grouped = data.reduce((acc, item) => {
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
  const dateFrom = useMemo(() => Date.now() - 30 * 24 * 60 * 60 * 1000, [])

  const inventoryItems = useQuery(
    api.inventory.listStockLevels,
    user ? {} : 'skip',
  )
  const transactions = useQuery(
    api.inventory.listTransactions,
    user ? { dateFrom, limit: 200 } : 'skip',
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
      averageTurnover: 15,
      stockValue: totalValue,
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
  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8']

  return (
    <Layout title="Inventory Overview">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Inventory' },
          { label: 'Overview' },
        ]}
        description="Key inventory metrics, quick actions, and recent stock movement."
        related={[
          { label: 'Stock levels', href: '/stock-levels' },
          { label: 'Lots', href: '/inventory/lots' },
          { label: 'Adjust / transfer', href: '/inventory/adjust' },
          { label: 'Alerts', href: '/inventory-alerts' },
          { label: 'Ledger', href: '/inventory-transactions' },
        ]}
      />

      {loading ? (
        <div className="py-12 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-lagoon-800 mx-auto" />
          <p className="mt-3 text-muted">Loading inventory…</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Link href="/inventory/transactions">
              <button className="w-full flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-md text-white bg-lagoon-800 hover:bg-lagoon-950">
                <ShoppingCart className="w-5 h-5 mr-2" />
                Record Transaction
              </button>
            </Link>
            <Link href="/inventory/items">
              <button className="w-full flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700">
                <Package className="w-5 h-5 mr-2" />
                Manage Items
              </button>
            </Link>
            <Link href="/inventory/categories">
              <button className="w-full flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-700">
                <BarChart2 className="w-5 h-5 mr-2" />
                Manage Categories
              </button>
            </Link>
            <Link href="/inventory/reports">
              <button className="w-full flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-md text-white bg-lagoon-800 hover:bg-lagoon-950">
                <BarChart2 className="w-5 h-5 mr-2" />
                View Reports
              </button>
            </Link>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
            {[
              {
                title: 'Total Stock',
                value: metrics.totalItems.toFixed(0),
                unit: 'kg',
                icon: Package,
                color: 'blue',
                trend: { value: 5, direction: 'up' },
              },
              {
                title: 'Total Value',
                value: metrics.totalValue.toFixed(2),
                unit: '₵',
                icon: DollarSign,
                color: 'green',
                trend: { value: 2.5, direction: 'up' },
              },
              {
                title: 'Low Stock Items',
                value: metrics.lowStockItems,
                unit: 'items',
                icon: AlertTriangle,
                color: 'red',
                trend: { value: 1, direction: 'down' },
              },
              {
                title: 'Monthly Transactions',
                value: metrics.monthlyTransactions,
                unit: 'transactions',
                icon: TrendingUp,
                color: 'purple',
                trend: { value: 3, direction: 'up' },
              },
              {
                title: 'Average Turnover',
                value: metrics.averageTurnover,
                unit: 'days',
                icon: Calendar,
                color: 'yellow',
                trend: { value: 2, direction: 'down' },
              },
              {
                title: 'Stock Value',
                value: metrics.stockValue.toFixed(2),
                unit: '₵',
                icon: DollarSign,
                color: 'indigo',
                trend: { value: 4, direction: 'up' },
              },
            ].map((metric, index) => (
              <div
                key={index}
                className="page-card p-6 hover:shadow-lg transition-shadow duration-300"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className={`p-3 rounded-full bg-${metric.color}-100 mr-4`}>
                      <metric.icon className={`w-6 h-6 text-${metric.color}-600`} />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted">{metric.title}</p>
                      <p className="text-2xl font-semibold text-chart-ink">
                        {metric.unit === '₵' ? metric.unit : ''}
                        {metric.value}
                        {metric.unit !== '₵' ? ` ${metric.unit}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center">
                    {metric.trend.direction === 'up' ? (
                      <ArrowUp className="w-4 h-4 text-green-500" />
                    ) : (
                      <ArrowDown className="w-4 h-4 text-red-500" />
                    )}
                    <span
                      className={`ml-1 text-sm ${
                        metric.trend.direction === 'up'
                          ? 'text-green-500'
                          : 'text-red-500'
                      }`}
                    >
                      {metric.trend.value}%
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className="page-card p-6">
              <h3 className="text-lg font-medium text-chart-ink mb-4">
                Transaction Trend
              </h3>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={transactionData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="in"
                      stackId="1"
                      stroke="#8884d8"
                      fill="#8884d8"
                    />
                    <Area
                      type="monotone"
                      dataKey="out"
                      stackId="1"
                      stroke="#82ca9d"
                      fill="#82ca9d"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="page-card p-6">
              <h3 className="text-lg font-medium text-chart-ink mb-4">
                Category Distribution
              </h3>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryData}
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
                      {categoryData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={COLORS[index % COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="page-card p-6">
              <h3 className="text-lg font-medium text-chart-ink mb-4">Stock Trend</h3>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="value"
                      stroke="#8884d8"
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="page-card p-6">
              <h3 className="text-lg font-medium text-chart-ink mb-4">
                Low Stock Alerts
              </h3>
              <div className="space-y-4">
                {lowStock.length === 0 ? (
                  <p className="text-sm text-muted">No low-stock items.</p>
                ) : (
                  lowStock.map((item) => (
                    <div
                      key={item.feed_type_id}
                      className="flex items-center justify-between p-4 bg-red-50 rounded-lg"
                    >
                      <div>
                        <p className="font-medium text-chart-ink">
                          {item.feed_type_name}
                        </p>
                        <p className="text-sm text-muted">
                          Current: {item.current_stock} kg
                          {item.current_stock_bags != null
                            ? ` (${Number(item.current_stock_bags).toFixed(1)} bags)`
                            : ''}{' '}
                          | Minimum: {item.minimum_stock} kg
                        </p>
                      </div>
                      <Link href="/inventory-transactions">
                        <button className="text-sm text-lagoon-800 hover:text-lagoon-950">
                          Order Now
                        </button>
                      </Link>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="page-card overflow-hidden">
            <div className="px-6 py-4 border-b border-foam-deep">
              <h3 className="text-lg font-medium text-chart-ink">Feed Types</h3>
            </div>
            <div className="divide-y divide-foam-deep">
              {(inventoryItems || []).slice(0, 5).map((item) => (
                <div key={item.feed_type_id} className="px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-chart-ink">
                        {item.feed_type_name}
                      </p>
                      <p className="text-sm text-muted">
                        Stock: {item.current_stock} kg
                        {item.current_stock_bags != null
                          ? ` (${Number(item.current_stock_bags).toFixed(1)} bags)`
                          : ''}{' '}
                        | Price: ₵{item.price_per_kg}/kg
                      </p>
                    </div>
                    <div className="text-sm text-muted">
                      Value: ₵{(item.stock_value || 0).toFixed(2)}
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
