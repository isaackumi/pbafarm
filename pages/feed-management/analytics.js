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
  Filter,
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
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
} from 'recharts'

export default function FeedAnalyticsPage() {
  return (
    <ProtectedRoute>
      <FeedAnalytics />
    </ProtectedRoute>
  )
}

function FeedAnalytics() {
  const router = useRouter()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [timeRange, setTimeRange] = useState('30d')
  const [feedTypes, setFeedTypes] = useState([])
  const [usageData, setUsageData] = useState([])
  const [costData, setCostData] = useState([])
  const [efficiencyData, setEfficiencyData] = useState([])
  const [supplierData, setSupplierData] = useState([])
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

      // Fetch feed types
      const { data: feedTypesData, error: feedTypesError } = await supabase
        .from('feed_types')
        .select(`
          *,
          supplier:feed_suppliers(name)
        `)
        .eq('active', true)

      if (feedTypesError) throw feedTypesError
      setFeedTypes(feedTypesData || [])

      // Fetch feed usage data
      const { data: usageData, error: usageError } = await supabase
        .from('feed_usage')
        .select(`
          *,
          feed_type:feed_types(name)
        `)
        .gte('usage_date', startDate.toISOString())
        .lte('usage_date', endDate.toISOString())
        .order('usage_date', { ascending: true })

      if (usageError) throw usageError

      // Fetch feed purchases
      const { data: purchaseData, error: purchaseError } = await supabase
        .from('feed_purchases')
        .select(`
          *,
          feed_type:feed_types(name)
        `)
        .gte('purchase_date', startDate.toISOString())
        .lte('purchase_date', endDate.toISOString())
        .order('purchase_date', { ascending: true })

      if (purchaseError) throw purchaseError

      // Process data for charts
      const processedUsageData = processUsageData(usageData)
      setUsageData(processedUsageData)

      const processedCostData = processCostData(purchaseData)
      setCostData(processedCostData)

      const processedEfficiencyData = processEfficiencyData(usageData)
      setEfficiencyData(processedEfficiencyData)

      const processedSupplierData = processSupplierData(feedTypesData)
      setSupplierData(processedSupplierData)

    } catch (error) {
      console.error('Error fetching data:', error)
      showToast('error', 'Failed to load analytics data')
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
    // Group by date and calculate total cost
    const grouped = data.reduce((acc, item) => {
      const date = new Date(item.purchase_date).toLocaleDateString()
      if (!acc[date]) acc[date] = 0
      acc[date] += item.quantity * item.price_per_kg
      return acc
    }, {})

    return Object.entries(grouped).map(([date, value]) => ({
      date,
      value
    }))
  }

  const processEfficiencyData = (data) => {
    // Calculate FCR and other efficiency metrics
    return data.map(item => ({
      date: new Date(item.usage_date).toLocaleDateString(),
      fcr: item.fcr || 1.5, // This should be calculated based on actual data
      feedEfficiency: item.feed_efficiency || 0.8, // This should be calculated based on actual data
      survivalRate: item.survival_rate || 0.95, // This should be calculated based on actual data
    }))
  }

  const processSupplierData = (data) => {
    const supplierMap = data.reduce((acc, item) => {
      const supplier = item.supplier?.name || 'Unknown'
      if (!acc[supplier]) acc[supplier] = 0
      acc[supplier] += item.current_stock
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
              href="/feed-management/overview"
              className="text-indigo-600 hover:text-indigo-800 flex items-center mr-4"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Overview
            </Link>
            <h1 className="text-2xl font-bold text-gray-900">Feed Analytics</h1>
          </div>

          <div className="flex items-center space-x-4">
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
            >
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last 90 Days</option>
              <option value="1y">Last Year</option>
            </select>

            <button
              onClick={fetchData}
              className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 text-red-700 p-3 rounded-md text-sm">
            {error}
          </div>
        )}

        {/* Feed Usage Analysis */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Feed Usage Analysis</h3>
          <div className="h-96">
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

        {/* Cost Analysis */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Cost Trend</h3>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={costData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="#8884d8"
                    fill="#8884d8"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">Supplier Distribution</h3>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={supplierData}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    label
                  >
                    {supplierData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Efficiency Metrics */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Feed Efficiency Metrics</h3>
          <div className="h-96">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={efficiencyData}>
                <PolarGrid />
                <PolarAngleAxis dataKey="date" />
                <PolarRadiusAxis />
                <Radar
                  name="FCR"
                  dataKey="fcr"
                  stroke="#8884d8"
                  fill="#8884d8"
                  fillOpacity={0.6}
                />
                <Radar
                  name="Feed Efficiency"
                  dataKey="feedEfficiency"
                  stroke="#82ca9d"
                  fill="#82ca9d"
                  fillOpacity={0.6}
                />
                <Radar
                  name="Survival Rate"
                  dataKey="survivalRate"
                  stroke="#ffc658"
                  fill="#ffc658"
                  fillOpacity={0.6}
                />
                <Legend />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Key Performance Indicators */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          {[
            {
              title: 'Average FCR',
              value: '1.5',
              unit: '',
              icon: Scale,
              color: 'blue',
              trend: { value: 0.1, direction: 'down' }
            },
            {
              title: 'Feed Cost/kg',
              value: '2.5',
              unit: '₵',
              icon: DollarSign,
              color: 'green',
              trend: { value: 0.2, direction: 'up' }
            },
            {
              title: 'Feed Efficiency',
              value: '80',
              unit: '%',
              icon: Percent,
              color: 'purple',
              trend: { value: 2, direction: 'up' }
            },
            {
              title: 'Survival Rate',
              value: '95',
              unit: '%',
              icon: TrendingUp,
              color: 'yellow',
              trend: { value: 1, direction: 'up' }
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
                      {metric.unit !== '₵' ? metric.unit : ''}
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
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Recommendations</h3>
          <div className="space-y-4">
            {[
              {
                title: 'Optimize Feed Type Distribution',
                description: 'Consider adjusting feed type distribution based on current usage patterns and cost efficiency.',
                icon: Package,
                color: 'blue'
              },
              {
                title: 'Monitor Feed Efficiency',
                description: 'Track FCR closely and adjust feeding practices to improve efficiency.',
                icon: Scale,
                color: 'green'
              },
              {
                title: 'Review Supplier Performance',
                description: 'Evaluate supplier performance based on price, quality, and delivery reliability.',
                icon: ShoppingCart,
                color: 'purple'
              },
              {
                title: 'Cost Optimization',
                description: 'Look for opportunities to reduce feed costs through bulk purchasing or supplier negotiations.',
                icon: DollarSign,
                color: 'yellow'
              },
            ].map((recommendation, index) => (
              <div
                key={index}
                className="flex items-start p-4 bg-gray-50 rounded-lg"
              >
                <div className={`p-3 rounded-full bg-${recommendation.color}-100 mr-4`}>
                  <recommendation.icon className={`w-6 h-6 text-${recommendation.color}-600`} />
                </div>
                <div>
                  <h4 className="font-medium text-gray-900">{recommendation.title}</h4>
                  <p className="text-sm text-gray-500">{recommendation.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
} 