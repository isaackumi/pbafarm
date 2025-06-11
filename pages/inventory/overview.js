import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import {
  ArrowLeft,
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
} from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import { useToast } from '../../components/Toast'
import { supabase } from '../../lib/supabase'
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
} from 'recharts'

export default function InventoryOverviewPage() {
  return (
    <ProtectedRoute>
      <InventoryOverview />
    </ProtectedRoute>
  )
}

function InventoryOverview() {
  const router = useRouter()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [metrics, setMetrics] = useState({
    totalItems: 0,
    totalValue: 0,
    lowStockItems: 0,
    monthlyTransactions: 0,
    averageTurnover: 0,
    stockValue: 0,
  })
  const [inventoryItems, setInventoryItems] = useState([])
  const [transactionData, setTransactionData] = useState([])
  const [categoryData, setCategoryData] = useState([])
  const [trendData, setTrendData] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      // Fetch inventory items
      const { data: itemsData, error: itemsError } = await supabase
        .from('inventory_items')
        .select(`
          *,
          category:inventory_categories(name)
        `)
        .eq('active', true)

      if (itemsError) throw itemsError
      setInventoryItems(itemsData || [])

      // Fetch recent transactions
      const { data: transactionsData, error: transactionsError } = await supabase
        .from('inventory_transactions')
        .select(`
          *,
          item:inventory_items(name, category:inventory_categories(name))
        `)
        .gte('transaction_date', new Date(new Date().setDate(new Date().getDate() - 30)).toISOString())
        .order('transaction_date', { ascending: false })

      if (transactionsError) throw transactionsError

      // Calculate metrics
      const totalItems = itemsData.reduce((sum, item) => sum + (item.quantity || 0), 0)
      const totalValue = itemsData.reduce((sum, item) => sum + (item.quantity * item.unit_price || 0), 0)
      const lowStockItems = itemsData.filter(item => item.quantity <= item.minimum_quantity * 1.2).length
      const monthlyTransactions = transactionsData.length

      setMetrics({
        totalItems,
        totalValue,
        lowStockItems,
        monthlyTransactions,
        averageTurnover: 15, // This should be calculated based on actual data
        stockValue: totalValue,
      })

      // Process transaction data for charts
      const processedTransactionData = processTransactionData(transactionsData)
      setTransactionData(processedTransactionData)

      // Process category data
      const processedCategoryData = processCategoryData(itemsData)
      setCategoryData(processedCategoryData)

      // Process trend data
      const processedTrendData = processTrendData(transactionsData)
      setTrendData(processedTrendData)

    } catch (error) {
      console.error('Error fetching data:', error)
      showToast('error', 'Failed to load inventory data')
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
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <Link
              href="/dashboard"
              className="text-indigo-600 hover:text-indigo-800 flex items-center mr-4"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Dashboard
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">Inventory Overview</h1>
          </div>

          <button
            onClick={fetchData}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </button>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 text-red-700 p-3 rounded-md text-sm">
            {error}
          </div>
        )}

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Link href="/inventory/transactions">
            <button className="w-full flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700">
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
            <button className="w-full flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700">
              <BarChart2 className="w-5 h-5 mr-2" />
              View Reports
            </button>
          </Link>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
          {[
            {
              title: 'Total Items',
              value: metrics.totalItems.toFixed(0),
              unit: 'items',
              icon: Package,
              color: 'blue',
              trend: { value: 5, direction: 'up' }
            },
            {
              title: 'Total Value',
              value: metrics.totalValue.toFixed(2),
              unit: '₵',
              icon: DollarSign,
              color: 'green',
              trend: { value: 2.5, direction: 'up' }
            },
            {
              title: 'Low Stock Items',
              value: metrics.lowStockItems,
              unit: 'items',
              icon: AlertTriangle,
              color: 'red',
              trend: { value: 1, direction: 'down' }
            },
            {
              title: 'Monthly Transactions',
              value: metrics.monthlyTransactions,
              unit: 'transactions',
              icon: TrendingUp,
              color: 'purple',
              trend: { value: 3, direction: 'up' }
            },
            {
              title: 'Average Turnover',
              value: metrics.averageTurnover,
              unit: 'days',
              icon: Calendar,
              color: 'yellow',
              trend: { value: 2, direction: 'down' }
            },
            {
              title: 'Stock Value',
              value: metrics.stockValue.toFixed(2),
              unit: '₵',
              icon: DollarSign,
              color: 'indigo',
              trend: { value: 4, direction: 'up' }
            },
          ].map((metric, index) => (
            <div
              key={index}
              className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow duration-300"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className={`p-3 rounded-full bg-${metric.color}-100 mr-4`}>
                    <metric.icon className={`w-6 h-6 text-${metric.color}-600`} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-500">{metric.title}</p>
                    <p className="text-2xl font-semibold text-gray-900">
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

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Transaction Trend */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Transaction Trend</h3>
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

          {/* Category Distribution */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Category Distribution</h3>
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
                    label
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

          {/* Stock Trend */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Stock Trend</h3>
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

          {/* Low Stock Alerts */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Low Stock Alerts</h3>
            <div className="space-y-4">
              {inventoryItems
                .filter(item => item.quantity <= item.minimum_quantity * 1.2)
                .map(item => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-4 bg-red-50 rounded-lg"
                  >
                    <div>
                      <p className="font-medium text-gray-900">{item.name}</p>
                      <p className="text-sm text-gray-500">
                        Current: {item.quantity} {item.unit} | Minimum: {item.minimum_quantity} {item.unit}
                      </p>
                    </div>
                    <Link href="/inventory/transactions">
                      <button className="text-sm text-indigo-600 hover:text-indigo-800">
                        Order Now
                      </button>
                    </Link>
                  </div>
                ))}
            </div>
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">Recent Activity</h3>
          </div>
          <div className="divide-y divide-gray-200">
            {inventoryItems.slice(0, 5).map(item => (
              <div key={item.id} className="px-6 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{item.name}</p>
                    <p className="text-sm text-gray-500">
                      Stock: {item.quantity} {item.unit} | Price: ₵{item.unit_price}/{item.unit}
                    </p>
                  </div>
                  <div className="text-sm text-gray-500">
                    Last updated: {new Date(item.updated_at).toLocaleDateString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
} 