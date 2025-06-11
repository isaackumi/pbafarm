import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import {
  ArrowLeft,
  Plus,
  Edit,
  Trash,
  Check,
  X,
  Save,
  AlertCircle,
  TrendingUp,
  Calendar,
  DollarSign,
  Package,
  BarChart2,
  AlertTriangle,
  PieChart,
  LineChart,
  ShoppingCart,
  Users,
  Database,
  ChevronDown,
  ChevronUp
} from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import { useToast } from '../components/Toast'
import { supabase } from '../lib/supabase'
import { feedTypeService } from '../lib/feedTypeService'
import { feedService } from '../lib/feedService'
import { feedTrackingService } from '../lib/feedTrackingService'
import { formatCurrency, formatWeight, formatNumber } from '../lib/currencyUtils'
import {
  LineChart as RechartsLineChart,
  Line,
  BarChart as RechartsBarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Pie,
  Cell,
} from 'recharts'

export default function FeedPurchasesPage() {
  return (
    <ProtectedRoute>
      <FeedPurchases />
    </ProtectedRoute>
  )
}

function FeedPurchases() {
  const router = useRouter()
  const { showToast } = useToast()

  const [feedTypes, setFeedTypes] = useState([])
  const [purchases, setPurchases] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingPurchase, setEditingPurchase] = useState(null)
  const [formData, setFormData] = useState({
    feed_type_id: '',
    quantity: '',
    price_per_kg: '',
    purchase_date: new Date().toISOString().split('T')[0],
    supplier_id: '',
    batch_number: '',
    expiry_date: '',
    notes: '',
  })
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [timeRange, setTimeRange] = useState('30d')
  const [feedUsage, setFeedUsage] = useState([])
  const [lowStockAlerts, setLowStockAlerts] = useState([])
  const [stats, setStats] = useState({
    totalPurchases: 0,
    totalCost: 0,
    totalQuantity: 0,
    averageCostPerKg: 0,
    feedTypeDistribution: [],
    supplierDistribution: [],
    monthlyUsage: [],
    stockValue: 0,
  })
  const [costAnalysis, setCostAnalysis] = useState({
    costTrends: [],
    supplierComparison: [],
    projectedCosts: [],
    savingsOpportunities: []
  })
  const [inventoryMetrics, setInventoryMetrics] = useState({
    stockLevels: [],
    stockValue: 0,
    daysRemaining: {},
    reorderRecommendations: []
  })
  const [usageAnalytics, setUsageAnalytics] = useState({
    cageUsage: [],
    fcrByType: {},
    efficiencyMetrics: {},
    historicalTrends: []
  })
  const [supplierMetrics, setSupplierMetrics] = useState({
    reliability: [],
    priceComparison: [],
    deliveryPerformance: {},
    qualityMetrics: {}
  })

  // Fetch data on mount
  useEffect(() => {
    fetchData()
  }, [timeRange])

  const fetchData = async () => {
    setLoading(true)
    try {
      // Fetch feed types
      const { data: feedTypesData, error: feedTypesError } = await feedTrackingService.getCurrentStockLevels()
      if (feedTypesError) throw feedTypesError
      setFeedTypes(feedTypesData || [])

      // Fetch purchases
      const { data: purchasesData, error: purchasesError } = await feedTrackingService.getFeedUsageStats(timeRange)
      if (purchasesError) throw purchasesError
      setPurchases(purchasesData || [])

      // Fetch cost analysis
      const { data: costAnalysis, error: costError } = await feedTrackingService.getFeedCostAnalysis(timeRange)
      if (costError) throw costError
      setCostAnalysis(costAnalysis)

      // Fetch low stock alerts
      const { data: lowStockData, error: lowStockError } = await feedTrackingService.getLowStockAlerts()
      if (lowStockError) throw lowStockError
      setLowStockAlerts(lowStockData || [])

      // Calculate statistics
      const stats = calculateStats(purchasesData)
      setStats(stats)

      // Calculate new metrics
      const inventoryMetricsData = calculateInventoryMetrics(feedTypesData, purchasesData, feedUsage)
      setInventoryMetrics(inventoryMetricsData)

      const usageAnalyticsData = calculateUsageAnalytics(purchasesData, feedUsage, cages)
      setUsageAnalytics(usageAnalyticsData)

      const supplierMetricsData = calculateSupplierMetrics(purchasesData, suppliers)
      setSupplierMetrics(supplierMetricsData)

    } catch (error) {
      console.error('Error fetching data:', error)
      showToast('error', 'Failed to load data')
      setError('Failed to load data. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const calculateStats = (purchases) => {
    const stats = {
      totalCost: 0,
      totalQuantity: 0,
      averageCostPerKg: 0,
      feedTypeDistribution: [],
      supplierDistribution: [],
      monthlyUsage: [],
      stockValue: 0
    }

    if (!purchases || !Array.isArray(purchases)) {
      return stats
    }

    const monthlyMap = new Map()
    const feedTypeMap = new Map()
    const supplierMap = new Map()

    purchases.forEach(purchase => {
      // Total cost and quantity
      stats.totalCost += purchase.quantity * purchase.price_per_kg
      stats.totalQuantity += purchase.quantity

      // Monthly usage
      const month = new Date(purchase.purchase_date).toLocaleString('default', { month: 'short' })
      monthlyMap.set(month, (monthlyMap.get(month) || 0) + purchase.quantity)

      // Feed type distribution
      const feedType = purchase.feed_type?.name || 'Unknown'
      feedTypeMap.set(feedType, (feedTypeMap.get(feedType) || 0) + purchase.quantity)

      // Supplier distribution
      const supplier = purchase.supplier?.name || 'Unknown'
      supplierMap.set(supplier, (supplierMap.get(supplier) || 0) + purchase.quantity)
    })

    // Calculate average cost per kg
    if (stats.totalQuantity > 0) {
      stats.averageCostPerKg = stats.totalCost / stats.totalQuantity
    }

    // Convert maps to arrays for charts
    stats.monthlyUsage = Array.from(monthlyMap.entries()).map(([month, quantity]) => ({
      month,
      quantity
    }))

    stats.feedTypeDistribution = Array.from(feedTypeMap.entries()).map(([name, quantity]) => ({
      name,
      quantity
    }))

    stats.supplierDistribution = Array.from(supplierMap.entries()).map(([name, quantity]) => ({
      name,
      quantity
    }))

    return stats
  }

  const calculateCostAnalysis = (purchases, feedTypes) => {
    const analysis = {
      costTrends: [],
      supplierComparison: [],
      projectedCosts: [],
      savingsOpportunities: []
    }

    // Calculate cost trends
    const monthlyCosts = {}
    purchases.forEach(purchase => {
      const month = new Date(purchase.purchase_date).toLocaleString('default', { month: 'short', year: 'numeric' })
      if (!monthlyCosts[month]) {
        monthlyCosts[month] = 0
      }
      monthlyCosts[month] += purchase.quantity * purchase.price_per_kg
    })

    analysis.costTrends = Object.entries(monthlyCosts).map(([month, cost]) => ({
      month,
      cost
    }))

    // Calculate supplier comparison
    const supplierCosts = {}
    purchases.forEach(purchase => {
      const supplier = purchase.suppliers?.name || 'Unknown'
      if (!supplierCosts[supplier]) {
        supplierCosts[supplier] = {
          totalCost: 0,
          totalQuantity: 0,
          averagePrice: 0
        }
      }
      supplierCosts[supplier].totalCost += purchase.quantity * purchase.price_per_kg
      supplierCosts[supplier].totalQuantity += purchase.quantity
    })

    analysis.supplierComparison = Object.entries(supplierCosts).map(([supplier, data]) => ({
      supplier,
      averagePrice: data.totalCost / data.totalQuantity,
      totalQuantity: data.totalQuantity
    }))

    return analysis
  }

  const calculateInventoryMetrics = (feedTypes, purchases, usage) => {
    const metrics = {
      stockLevels: [],
      stockValue: 0,
      daysRemaining: {},
      reorderRecommendations: []
    }

    // Calculate stock levels and value
    metrics.stockLevels = feedTypes.map(feed => ({
      name: feed.name,
      currentStock: feed.current_stock,
      minimumStock: feed.minimum_stock,
      percentage: (feed.current_stock / feed.minimum_stock) * 100
    }))

    metrics.stockValue = feedTypes.reduce((total, feed) => {
      return total + (feed.current_stock * feed.price_per_kg)
    }, 0)

    // Calculate days remaining based on average daily usage
    const averageDailyUsage = {}
    usage.forEach(record => {
      const feedType = record.feed_types?.name
      if (!averageDailyUsage[feedType]) {
        averageDailyUsage[feedType] = {
          totalUsage: 0,
          days: 0
        }
      }
      averageDailyUsage[feedType].totalUsage += record.quantity
      averageDailyUsage[feedType].days++
    })

    Object.entries(averageDailyUsage).forEach(([feedType, data]) => {
      const avgDailyUsage = data.totalUsage / data.days
      const feed = feedTypes.find(f => f.name === feedType)
      if (feed) {
        metrics.daysRemaining[feedType] = Math.floor(feed.current_stock / avgDailyUsage)
      }
    })

    // Generate reorder recommendations
    metrics.reorderRecommendations = feedTypes
      .filter(feed => feed.current_stock <= feed.minimum_stock * 1.2)
      .map(feed => ({
        name: feed.name,
        currentStock: feed.current_stock,
        minimumStock: feed.minimum_stock,
        recommendedOrder: feed.minimum_stock * 2 - feed.current_stock
      }))

    return metrics
  }

  const calculateUsageAnalytics = (purchases, usage, cages) => {
    const analytics = {
      cageUsage: [],
      fcrByType: {},
      efficiencyMetrics: {},
      historicalTrends: []
    }

    // Calculate cage usage
    analytics.cageUsage = cages.map(cage => {
      const cageUsage = usage.filter(u => u.cage_id === cage.id)
      const totalUsage = cageUsage.reduce((sum, u) => sum + u.quantity, 0)
      return {
        cageName: cage.name,
        totalUsage,
        averageDailyUsage: totalUsage / (cageUsage.length || 1)
      }
    })

    // Calculate FCR by feed type
    const feedTypeUsage = {}
    usage.forEach(record => {
      const feedType = record.feed_types?.name
      if (!feedTypeUsage[feedType]) {
        feedTypeUsage[feedType] = {
          totalFeed: 0,
          totalWeightGain: 0
        }
      }
      feedTypeUsage[feedType].totalFeed += record.quantity
    })

    analytics.fcrByType = Object.entries(feedTypeUsage).map(([feedType, data]) => ({
      feedType,
      fcr: data.totalWeightGain > 0 ? data.totalFeed / data.totalWeightGain : 0
    }))

    return analytics
  }

  const calculateSupplierMetrics = (purchases, suppliers) => {
    const metrics = {
      reliability: [],
      priceComparison: [],
      deliveryPerformance: {},
      qualityMetrics: {}
    }

    // Calculate supplier reliability
    const supplierOrders = {}
    purchases.forEach(purchase => {
      const supplier = purchase.suppliers?.name || 'Unknown'
      if (!supplierOrders[supplier]) {
        supplierOrders[supplier] = {
          totalOrders: 0,
          onTimeDeliveries: 0,
          totalCost: 0,
          totalQuantity: 0
        }
      }
      supplierOrders[supplier].totalOrders++
      supplierOrders[supplier].totalCost += purchase.quantity * purchase.price_per_kg
      supplierOrders[supplier].totalQuantity += purchase.quantity

      // Assuming delivery is on time if within 2 days of purchase date
      const deliveryDate = new Date(purchase.purchase_date)
      const expectedDate = new Date(purchase.expected_delivery_date || purchase.purchase_date)
      if (Math.abs(deliveryDate - expectedDate) <= 2 * 24 * 60 * 60 * 1000) {
        supplierOrders[supplier].onTimeDeliveries++
      }
    })

    // Convert supplier orders to reliability array
    metrics.reliability = Object.entries(supplierOrders).map(([supplier, data]) => ({
      supplier,
      reliability: (data.onTimeDeliveries / data.totalOrders) * 100,
      totalOrders: data.totalOrders,
      averagePrice: data.totalCost / data.totalQuantity
    }))

    // Sort reliability by number of orders (most orders first)
    metrics.reliability.sort((a, b) => b.totalOrders - a.totalOrders)

    // Calculate price comparison
    metrics.priceComparison = metrics.reliability.map(item => ({
      supplier: item.supplier,
      averagePrice: item.averagePrice,
      totalOrders: item.totalOrders
    }))

    return metrics
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }))
  }

  const handleAddPurchase = () => {
    setFormData({
      feed_type_id: '',
      quantity: '',
      price_per_kg: '',
      purchase_date: new Date().toISOString().split('T')[0],
      supplier_id: '',
      batch_number: '',
      expiry_date: '',
      notes: '',
    })
    setError('')
    setSuccess('')
    setShowAddModal(true)
  }

  const handleEditPurchase = (purchase) => {
    setEditingPurchase(purchase)
    setFormData({
      feed_type_id: purchase.feed_type_id,
      quantity: purchase.quantity,
      price_per_kg: purchase.price_per_kg,
      purchase_date: purchase.purchase_date,
      supplier_id: purchase.supplier_id,
      batch_number: purchase.batch_number || '',
      expiry_date: purchase.expiry_date || '',
      notes: purchase.notes || '',
    })
    setError('')
    setSuccess('')
    setShowEditModal(true)
  }

  const handleSubmitAdd = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    try {
      if (!formData.feed_type_id || !formData.quantity || !formData.price_per_kg) {
        throw new Error('Please fill in all required fields')
      }

      const purchaseData = {
        feed_type_id: formData.feed_type_id,
        quantity: parseFloat(formData.quantity),
        price_per_kg: parseFloat(formData.price_per_kg),
        purchase_date: formData.purchase_date || new Date().toISOString(),
        supplier_id: formData.supplier_id,
        batch_number: formData.batch_number,
        expiry_date: formData.expiry_date,
        notes: formData.notes
      }

      const { error } = await feedTrackingService.recordFeedUsage(purchaseData)
      if (error) throw error

      setSuccess('Purchase recorded successfully')
      showToast('success', 'Purchase recorded successfully')
      setTimeout(() => {
        setShowAddModal(false)
        fetchData()
      }, 1500)
    } catch (error) {
      setError(error.message)
    }
  }

  const handleSubmitEdit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    try {
      if (!editingPurchase) return
      const { data, error } = await feedService.updatePurchase(editingPurchase.id, formData)
      if (error) throw error

      showToast('success', 'Purchase updated successfully')
      setSuccess('Purchase updated successfully')
      setTimeout(() => {
        setShowEditModal(false)
        fetchData()
      }, 1500)
    } catch (error) {
      setError(error.message)
    }
  }

  const handleDeletePurchase = async (id) => {
    try {
      const { error } = await feedService.deletePurchase(id)
      if (error) throw error

      showToast('success', 'Purchase deleted successfully')
      fetchData()
      setDeleteConfirm(null)
    } catch (error) {
      showToast('error', error.message || 'Failed to delete purchase')
    }
  }

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8', '#82CA9D']

  return (
    <div className="min-h-screen bg-gray-100 font-montserrat">
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
            <h1 className="text-2xl font-bold text-gray-900">Feed Purchases</h1>
          </div>

          <button
            onClick={handleAddPurchase}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
          >
            <Plus className="w-4 h-4 mr-2" />
            Record Purchase
          </button>
        </div>

        {/* Time Range Selector */}
        <div className="flex justify-end space-x-2 mb-6">
          {['7d', '30d', '90d', '1y'].map(range => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-3 py-1 rounded-md text-sm ${
                timeRange === range
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {range}
            </button>
          ))}
        </div>

        {/* Low Stock Alerts */}
        {lowStockAlerts.length > 0 && (
          <div className="mb-6">
            <div className="bg-red-50 border-l-4 border-red-400 p-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">Low Stock Alert</h3>
                  <div className="mt-2 text-sm text-red-700">
                    <ul className="list-disc pl-5 space-y-1">
                      {lowStockAlerts.map((feed) => (
                        <li key={feed.id}>
                          {feed.name}: {feed.current_stock}kg remaining (Minimum: {feed.minimum_stock}kg)
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-indigo-100 text-indigo-600">
                <DollarSign className="w-6 h-6" />
              </div>
              <div className="ml-4">
                <h3 className="text-sm font-medium text-gray-500">Total Cost</h3>
                <div className="text-2xl font-semibold text-gray-900">
                  {formatCurrency(stats.totalCost)}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-green-100 text-green-600">
                <Package className="w-6 h-6" />
              </div>
              <div className="ml-4">
                <h3 className="text-sm font-medium text-gray-500">Total Quantity</h3>
                <div className="text-2xl font-semibold text-gray-900">
                  {formatWeight(stats.totalQuantity)}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-blue-100 text-blue-600">
                <BarChart2 className="w-6 h-6" />
              </div>
              <div className="ml-4">
                <h3 className="text-sm font-medium text-gray-500">Avg. Cost/kg</h3>
                <div className="text-2xl font-semibold text-gray-900">
                  {formatCurrency(stats.averageCostPerKg)}
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center">
              <div className="p-3 rounded-full bg-purple-100 text-purple-600">
                <Database className="w-6 h-6" />
              </div>
              <div className="ml-4">
                <h3 className="text-sm font-medium text-gray-500">Current Stock Value</h3>
                <div className="text-2xl font-semibold text-gray-900">
                  {formatCurrency(stats.stockValue)}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Cost Analysis Section */}
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Cost Analysis</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Cost Trends Chart */}
            <div className="bg-white rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-700 mb-4">Cost Trends</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsLineChart data={costAnalysis.costTrends}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip />
                    <Line type="monotone" dataKey="cost" stroke="#8884d8" />
                  </RechartsLineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Supplier Comparison Chart */}
            <div className="bg-white rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-700 mb-4">Supplier Price Comparison</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsBarChart data={costAnalysis.supplierComparison}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="supplier" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="averagePrice" fill="#8884d8" />
                  </RechartsBarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>

        {/* Inventory Management Section */}
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Inventory Management</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Stock Levels */}
            <div className="bg-white rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-700 mb-4">Current Stock Levels</h3>
              <div className="space-y-4">
                {inventoryMetrics.stockLevels.map((stock, index) => (
                  <div key={index} className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">{stock.name}</span>
                    <div className="flex items-center">
                      <div className="w-32 bg-gray-200 rounded-full h-2.5 mr-2">
                        <div
                          className={`h-2.5 rounded-full ${
                            stock.percentage < 50 ? 'bg-red-600' : 'bg-green-600'
                          }`}
                          style={{ width: `${Math.min(stock.percentage, 100)}%` }}
                        ></div>
                      </div>
                      <span className="text-sm text-gray-600">
                        {stock.currentStock}kg
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Reorder Recommendations */}
            <div className="bg-white rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-700 mb-4">Reorder Recommendations</h3>
              <div className="space-y-4">
                {inventoryMetrics.reorderRecommendations.map((rec, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-yellow-50 rounded-lg">
                    <div>
                      <span className="text-sm font-medium text-gray-900">{rec.name}</span>
                      <p className="text-xs text-gray-500">
                        Current: {rec.currentStock}kg | Min: {rec.minimumStock}kg
                      </p>
                    </div>
                    <button className="px-3 py-1 text-sm text-white bg-indigo-600 rounded-md hover:bg-indigo-700">
                      Order {rec.recommendedOrder}kg
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Usage Analytics Section */}
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Usage Analytics</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Cage Usage Chart */}
            <div className="bg-white rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-700 mb-4">Feed Usage by Cage</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsBarChart data={usageAnalytics.cageUsage}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="cageName" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="totalUsage" fill="#8884d8" />
                  </RechartsBarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* FCR by Feed Type */}
            <div className="bg-white rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-700 mb-4">FCR by Feed Type</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsBarChart data={usageAnalytics.fcrByType}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="feedType" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="fcr" fill="#82ca9d" />
                  </RechartsBarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>

        {/* Supplier Performance Section */}
        <div className="bg-white shadow rounded-lg p-6 mb-6">
          <h2 className="text-lg font-medium text-gray-900 mb-4">Supplier Performance</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Supplier Reliability */}
            <div className="bg-white rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-700 mb-4">Supplier Reliability</h3>
              <div className="space-y-4">
                {supplierMetrics.reliability && supplierMetrics.reliability.length > 0 ? (
                  supplierMetrics.reliability.map((metric, index) => (
                    <div key={index} className="flex items-center justify-between">
                      <div className="flex-1">
                        <span className="text-sm font-medium text-gray-900">{metric.supplier}</span>
                        <p className="text-xs text-gray-500">{metric.totalOrders} orders</p>
                      </div>
                      <div className="flex items-center ml-4">
                        <div className="w-32 bg-gray-200 rounded-full h-2.5 mr-2">
                          <div
                            className={`h-2.5 rounded-full ${
                              metric.reliability < 80 ? 'bg-red-600' : 'bg-green-600'
                            }`}
                            style={{ width: `${Math.min(metric.reliability, 100)}%` }}
                          ></div>
                        </div>
                        <span className="text-sm text-gray-600">
                          {metric.reliability.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-gray-500 text-center py-4">
                    No supplier data available
                  </div>
                )}
              </div>
            </div>

            {/* Price Comparison */}
            <div className="bg-white rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-700 mb-4">Price Comparison</h3>
              <div className="h-64">
                {supplierMetrics.priceComparison && supplierMetrics.priceComparison.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsBarChart data={supplierMetrics.priceComparison}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="supplier" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="averagePrice" fill="#8884d8" />
                    </RechartsBarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-sm text-gray-500">
                    No price comparison data available
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Purchases Table */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="font-medium text-gray-700">Recent Purchases</h2>
          </div>

          {loading ? (
            <div className="py-12 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
              <p className="mt-3 text-gray-500">Loading purchases...</p>
            </div>
          ) : purchases.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Feed Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Quantity
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Price/kg
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Total Cost
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Purchase Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Batch Number
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {purchases.map((purchase) => (
                    <tr key={purchase.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {purchase.feed_types?.name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {purchase.quantity} kg
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        ${purchase.price_per_kg}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        ${(purchase.quantity * purchase.price_per_kg).toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(purchase.purchase_date).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {purchase.batch_number || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <div className="flex space-x-3">
                          <button
                            onClick={() => handleEditPurchase(purchase)}
                            className="text-indigo-600 hover:text-indigo-800"
                            title="Edit Purchase"
                          >
                            <Edit className="w-4 h-4" />
                          </button>

                          {deleteConfirm === purchase.id ? (
                            <>
                              <button
                                onClick={() => handleDeletePurchase(purchase.id)}
                                className="text-red-600 hover:text-red-800"
                                title="Confirm Delete"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setDeleteConfirm(null)}
                                className="text-gray-600 hover:text-gray-800"
                                title="Cancel"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => setDeleteConfirm(purchase.id)}
                              className="text-red-600 hover:text-red-800"
                              title="Delete Purchase"
                            >
                              <Trash className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center">
              <AlertCircle className="h-12 w-12 text-gray-400 mx-auto" />
              <p className="mt-3 text-gray-500">
                No purchases found. Record your first purchase to get started.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Add Purchase Modal */}
      {showAddModal && (
        <div className="fixed inset-0 overflow-y-auto z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black bg-opacity-50"
            onClick={() => setShowAddModal(false)}
          ></div>
          <div className="relative bg-white rounded-lg max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Record New Purchase
            </h3>

            {error && (
              <div className="mb-4 bg-red-50 text-red-700 p-3 rounded-md text-sm">
                {error}
              </div>
            )}

            {success && (
              <div className="mb-4 bg-green-50 text-green-700 p-3 rounded-md text-sm">
                {success}
              </div>
            )}

            <form onSubmit={handleSubmitAdd} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Feed Type <span className="text-red-500">*</span>
                </label>
                <select
                  name="feed_type_id"
                  value={formData.feed_type_id}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  required
                >
                  <option value="">Select feed type</option>
                  {feedTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Quantity (kg) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  name="quantity"
                  value={formData.quantity}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Price per kg ($) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  name="price_per_kg"
                  value={formData.price_per_kg}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Purchase Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  name="purchase_date"
                  value={formData.purchase_date}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Batch Number
                </label>
                <input
                  type="text"
                  name="batch_number"
                  value={formData.batch_number}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expiry Date
                </label>
                <input
                  type="date"
                  name="expiry_date"
                  value={formData.expiry_date}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes
                </label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleChange}
                  rows={3}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
                >
                  <Save className="w-4 h-4 mr-2 inline-block" />
                  Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Purchase Modal */}
      {showEditModal && editingPurchase && (
        <div className="fixed inset-0 overflow-y-auto z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black bg-opacity-50"
            onClick={() => setShowEditModal(false)}
          ></div>
          <div className="relative bg-white rounded-lg max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              Edit Purchase
            </h3>

            {error && (
              <div className="mb-4 bg-red-50 text-red-700 p-3 rounded-md text-sm">
                {error}
              </div>
            )}

            {success && (
              <div className="mb-4 bg-green-50 text-green-700 p-3 rounded-md text-sm">
                {success}
              </div>
            )}

            <form onSubmit={handleSubmitEdit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Feed Type <span className="text-red-500">*</span>
                </label>
                <select
                  name="feed_type_id"
                  value={formData.feed_type_id}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  required
                >
                  <option value="">Select feed type</option>
                  {feedTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Quantity (kg) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  name="quantity"
                  value={formData.quantity}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Price per kg ($) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  name="price_per_kg"
                  value={formData.price_per_kg}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Purchase Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  name="purchase_date"
                  value={formData.purchase_date}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Batch Number
                </label>
                <input
                  type="text"
                  name="batch_number"
                  value={formData.batch_number}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Expiry Date
                </label>
                <input
                  type="date"
                  name="expiry_date"
                  value={formData.expiry_date}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Notes
                </label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleChange}
                  rows={3}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
                >
                  <Save className="w-4 h-4 mr-2 inline-block" />
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
} 