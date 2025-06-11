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
    averageFCR: 0,
    feedCostPerKg: 0,
  })
  const [feedTypes, setFeedTypes] = useState([])
  const [usageData, setUsageData] = useState([])
  const [costData, setCostData] = useState([])
  const [supplierData, setSupplierData] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchData()
  }, [])

  const fetchData = async () => {
    setLoading(true)
    try {
      // Fetch feed types with current stock
      const { data: feedTypesData, error: feedTypesError } = await supabase
        .from('feed_types')
        .select(`
          *,
          supplier:feed_suppliers(name)
        `)
        .eq('active', true)

      if (feedTypesError) throw feedTypesError
      setFeedTypes(feedTypesData || [])

      // Fetch recent feed usage
      const { data: usageData, error: usageError } = await supabase
        .from('feed_usage')
        .select(`
          *,
          feed_type:feed_types(name)
        `)
        .gte('usage_date', new Date(new Date().setDate(new Date().getDate() - 30)).toISOString())
        .order('usage_date', { ascending: false })

      if (usageError) throw usageError

      // Calculate metrics
      const totalStock = feedTypesData.reduce((sum, type) => sum + (type.current_stock || 0), 0)
      const totalValue = feedTypesData.reduce((sum, type) => sum + (type.current_stock * type.price_per_kg || 0), 0)
      const lowStockItems = feedTypesData.filter(type => type.current_stock <= type.minimum_stock * 1.2).length
      const monthlyUsage = usageData.reduce((sum, usage) => sum + (usage.quantity || 0), 0)

      setMetrics({
        totalStock,
        totalValue,
        lowStockItems,
        monthlyUsage,
        averageFCR: 1.5, // This should be calculated based on actual data
        feedCostPerKg: 2.5, // This should be calculated based on actual data
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
      showToast('error', 'Failed to load feed management data')
      setError('Failed to load data. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const processUsageData = (data) => {
    // Group by date and feed type
    const grouped = data.reduce((acc, item) => {
      const date = new Date(item.usage_date).toLocaleDateString()
      if (!acc[date]) acc[date] = {}
      if (!acc[date][item.feed_type.name]) acc[date][item.feed_type.name] = 0
      acc[date][item.feed_type.name] += item.quantity
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
      const supplier = type.supplier?.name || 'Unknown'
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
            <h1 className="text-2xl font-bold text-gray-900">Feed Management Overview</h1>
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
          <Link href="/feed-management/purchases">
            <button className="w-full flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700">
              <ShoppingCart className="w-5 h-5 mr-2" />
              Record Purchase
            </button>
          </Link>
          <Link href="/feed-management/usage">
            <button className="w-full flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700">
              <Scale className="w-5 h-5 mr-2" />
              Record Usage
            </button>
          </Link>
          <Link href="/feed-management/types">
            <button className="w-full flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-700">
              <Package className="w-5 h-5 mr-2" />
              Manage Feed Types
            </button>
          </Link>
          <Link href="/feed-management/suppliers">
            <button className="w-full flex items-center justify-center px-4 py-3 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700">
              <BarChart2 className="w-5 h-5 mr-2" />
              Manage Suppliers
            </button>
          </Link>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-6">
          {[
            {
              title: 'Total Stock',
              value: metrics.totalStock.toFixed(2),
              unit: 'kg',
              icon: Package,
              color: 'blue',
            },
            {
              title: 'Total Value',
              value: metrics.totalValue.toFixed(2),
              unit: '₵',
              icon: DollarSign,
              color: 'green',
            },
            {
              title: 'Low Stock Items',
              value: metrics.lowStockItems,
              unit: 'items',
              icon: AlertTriangle,
              color: 'red',
            },
            {
              title: 'Monthly Usage',
              value: metrics.monthlyUsage.toFixed(2),
              unit: 'kg',
              icon: TrendingUp,
              color: 'purple',
            },
            {
              title: 'Average FCR',
              value: metrics.averageFCR.toFixed(2),
              unit: '',
              icon: Percent,
              color: 'yellow',
            },
            {
              title: 'Feed Cost/kg',
              value: metrics.feedCostPerKg.toFixed(2),
              unit: '₵',
              icon: DollarSign,
              color: 'indigo',
            },
          ].map((metric, index) => (
            <div
              key={index}
              className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow duration-300"
            >
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
            </div>
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Feed Usage Trend */}
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Feed Usage Trend</h3>
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
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Feed Cost Distribution</h3>
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
                    label
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
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Supplier Distribution</h3>
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
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Low Stock Alerts</h3>
            <div className="space-y-4">
              {feedTypes
                .filter(type => type.current_stock <= type.minimum_stock * 1.2)
                .map(type => (
                  <div
                    key={type.id}
                    className="flex items-center justify-between p-4 bg-red-50 rounded-lg"
                  >
                    <div>
                      <p className="font-medium text-gray-900">{type.name}</p>
                      <p className="text-sm text-gray-500">
                        Current: {type.current_stock.toFixed(2)} kg | Minimum: {type.minimum_stock.toFixed(2)} kg
                      </p>
                    </div>
                    <Link href="/feed-management/purchases">
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
            {feedTypes.slice(0, 5).map(type => (
              <div key={type.id} className="px-6 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900">{type.name}</p>
                    <p className="text-sm text-gray-500">
                      Stock: {type.current_stock.toFixed(2)} kg | Price: ₵{type.price_per_kg.toFixed(2)}/kg
                    </p>
                  </div>
                  <div className="text-sm text-gray-500">
                    Last updated: {new Date(type.updated_at).toLocaleDateString()}
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