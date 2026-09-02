import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import {
  Package,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  DollarSign,
  BarChart2,
  Calendar,
  RefreshCw,
  ShoppingCart,
  Scale,
  Percent,
  ArrowUp,
  ArrowDown,
  Filter,
} from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { PageHeader } from '../../components/ui'
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
  const router = useRouter()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [timeRange, setTimeRange] = useState('30d')
  const [inventoryItems, setInventoryItems] = useState([])
  const [transactionData, setTransactionData] = useState([])
  const [categoryData, setCategoryData] = useState([])
  const [trendData, setTrendData] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchData()
  }, [timeRange])

  const fetchData = async () => {
    setLoading(true)
    try {
      // Calculate date range based on selected time range
      const endDate = new Date()
      const startDate = new Date()
      switch (timeRange) {
        case '7d':
          startDate.setDate(startDate.getDate() - 7)
          break
        case '30d':
          startDate.setDate(startDate.getDate() - 30)
          break
        case '90d':
          startDate.setDate(startDate.getDate() - 90)
          break
        case '1y':
          startDate.setFullYear(startDate.getFullYear() - 1)
          break
        default:
          startDate.setDate(startDate.getDate() - 30)
      }

      const client = getConvexHttpClient()
      
      // Fetch inventory items (stock levels)
      const itemsData = await client.query(api.inventory.listStockLevels, {})
      setInventoryItems(itemsData || [])

      // Fetch transactions with date range
      const transactionsData = await client.query(api.inventory.listTransactions, {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString()
      })

      // Process data for charts
      const processedTransactionData = processTransactionData(transactionsData)
      setTransactionData(processedTransactionData)

      const processedCategoryData = processCategoryData(itemsData)
      setCategoryData(processedCategoryData)

      const processedTrendData = processTrendData(transactionsData)
      setTrendData(processedTrendData)

    } catch (error) {
      console.error('Error fetching data:', error)
      showToast('error', 'Failed to load analytics data')
      setError('Failed to load data. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const processTransactionData = (data) => {
    // Group by date and type
    const grouped = data.reduce((acc, item) => {
      const date = new Date(item.transaction_date).toLocaleDateString()
      if (!acc[date]) acc[date] = { in: 0, out: 0 }
      if (item.transaction_type === 'in') {
        acc[date].in += item.quantity
      } else {
        acc[date].out += item.quantity
      }
      return acc
    }, {})

    return Object.entries(grouped).map(([date, values]) => ({
      date,
      ...values
    }))
  }

  const processCategoryData = (data) => {
    const categoryMap = data.reduce((acc, item) => {
      const category = item.category?.name || 'Uncategorized'
      if (!acc[category]) acc[category] = 0
      acc[category] += item.quantity * item.unit_price
      return acc
    }, {})

    return Object.entries(categoryMap).map(([name, value]) => ({
      name,
      value
    }))
  }

  const processTrendData = (data) => {
    // Group by date and calculate net change
    const grouped = data.reduce((acc, item) => {
      const date = new Date(item.transaction_date).toLocaleDateString()
      if (!acc[date]) acc[date] = 0
      acc[date] += item.transaction_type === 'in' ? item.quantity : -item.quantity
      return acc
    }, {})

    return Object.entries(grouped).map(([date, value]) => ({
      date,
      value
    }))
  }

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8']

  return (
    <Layout title="Inventory Analytics">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Inventory', href: '/inventory/overview' },
          { label: 'Analytics' },
        ]}
        description="Transaction trends and inventory insights over the selected period."
        related={[
          { label: 'Overview', href: '/inventory/overview' },
          { label: 'Stock levels', href: '/stock-levels' },
          { label: 'Reports', href: '/report' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="rounded-xl border border-zinc-200 shadow-sm focus:border-lagoon-800 focus:ring-lagoon-800 text-sm min-h-10 px-3"
            >
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last 90 Days</option>
              <option value="1y">Last Year</option>
            </select>

            <button
              onClick={fetchData}
              className="inline-flex items-center px-3 py-2 text-sm font-semibold rounded-xl text-white bg-lagoon-950 hover:bg-lagoon-800 min-h-10"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </button>
          </div>
        }
      />

        {error && (
          <div className="mb-4 bg-red-50 text-red-700 p-3 rounded-md text-sm">
            {error}
          </div>
        )}

        {/* Transaction Analysis */}
        <div className="page-card p-6 mb-6">
          <h3 className="text-lg font-medium text-chart-ink mb-4">Transaction Analysis</h3>
          <div className="h-96">
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

        {/* Category Analysis */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="page-card p-6">
            <h3 className="text-lg font-medium text-chart-ink mb-4">Category Distribution</h3>
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
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
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
        </div>

        {/* Key Performance Indicators */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          {[
            {
              title: 'Total Items',
              value: inventoryItems.length,
              unit: 'items',
              icon: Package,
              color: 'blue',
              trend: { value: 5, direction: 'up' }
            },
            {
              title: 'Total Value',
              value: inventoryItems.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0).toFixed(2),
              unit: '₵',
              icon: DollarSign,
              color: 'green',
              trend: { value: 2.5, direction: 'up' }
            },
            {
              title: 'Turnover Rate',
              value: '15',
              unit: 'days',
              icon: Calendar,
              color: 'purple',
              trend: { value: 2, direction: 'down' }
            },
            {
              title: 'Stock Accuracy',
              value: '98',
              unit: '%',
              icon: Percent,
              color: 'yellow',
              trend: { value: 1, direction: 'up' }
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
                      {metric.unit === '₵' ? metric.unit : ''}{metric.value}
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
                  <span className={`ml-1 text-sm ${
                    metric.trend.direction === 'up' ? 'text-green-500' : 'text-red-500'
                  }`}>
                    {metric.trend.value}%
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Recommendations */}
        <div className="page-card p-6">
          <h3 className="text-lg font-medium text-chart-ink mb-4">Recommendations</h3>
          <div className="space-y-4">
            {[
              {
                title: 'Optimize Stock Levels',
                description: 'Review and adjust minimum stock levels based on usage patterns and lead times.',
                icon: Package,
                color: 'blue'
              },
              {
                title: 'Improve Turnover',
                description: 'Identify slow-moving items and develop strategies to improve turnover.',
                icon: TrendingUp,
                color: 'green'
              },
              {
                title: 'Category Analysis',
                description: 'Analyze category performance and adjust inventory mix accordingly.',
                icon: BarChart2,
                color: 'purple'
              },
              {
                title: 'Cost Optimization',
                description: 'Look for opportunities to reduce inventory costs through better forecasting.',
                icon: DollarSign,
                color: 'yellow'
              },
            ].map((recommendation, index) => (
              <div
                key={index}
                className="flex items-start p-4 bg-foam-deep/40 rounded-lg"
              >
                <div className={`p-3 rounded-full bg-${recommendation.color}-100 mr-4`}>
                  <recommendation.icon className={`w-6 h-6 text-${recommendation.color}-600`} />
                </div>
                <div>
                  <h4 className="font-medium text-chart-ink">{recommendation.title}</h4>
                  <p className="text-sm text-muted">{recommendation.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
    </Layout>
  )
} 