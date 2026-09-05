import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import {
  Plus,
  Edit,
  Trash,
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
import Layout from '../components/Layout'
import { PageHeader } from '../components/ui'
import FarmLocationSelect from '../components/FarmLocationSelect'
import FeedTypeField from '../components/FeedTypeField'
import BagSizeField from '../components/BagSizeField'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import { useToast } from '../components/Toast'
import { useLocation } from '../contexts/LocationContext'
import { feedService } from '../lib/feedService'
import { supplierService } from '../lib/supplierService'
import { cageService } from '../lib/cageService'
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
  const { activeLocationId } = useLocation()

  const [feedTypes, setFeedTypes] = useState([])
  const [purchases, setPurchases] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [editingPurchase, setEditingPurchase] = useState(null)
  const [formData, setFormData] = useState({
    feed_type_id: '',
    quantity: '',
    bags: '',
    bag_size_kg: '25',
    price_per_kg: '',
    purchase_date: new Date().toISOString().split('T')[0],
    supplier_id: '',
    batch_number: '',
    expiry_date: '',
    notes: '',
    locationId: '',
  })
  const [deleteConfirm, setDeleteConfirm] = useState(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [timeRange, setTimeRange] = useState('30d')
  const [feedUsage, setFeedUsage] = useState([])
  const [cages, setCages] = useState([])
  const [suppliers, setSuppliers] = useState([])
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
      const [
        feedTypesResult,
        purchasesResult,
        lowStockResult,
        usageResult,
        cagesResult,
        suppliersResult,
      ] = await Promise.all([
        feedService.getAllFeedTypes(),
        feedService.getAllPurchases(),
        feedService.getLowStockAlerts(),
        feedService.getFeedUsageStats(timeRange),
        cageService.getAllCages(),
        supplierService.getAllSuppliers(),
      ])

      if (feedTypesResult.error) throw feedTypesResult.error
      if (purchasesResult.error) throw purchasesResult.error
      if (lowStockResult.error) throw lowStockResult.error
      if (usageResult.error) throw usageResult.error
      if (cagesResult.error) throw cagesResult.error
      if (suppliersResult.error) throw suppliersResult.error

      const feedTypesData = feedTypesResult.data || []
      const suppliersData = suppliersResult.data || []
      const cagesData = cagesResult.data || []
      const feedById = Object.fromEntries(
        feedTypesData.map((t) => [t.id || t._id, t]),
      )
      const supplierById = {}
      for (const s of suppliersData) {
        const id = s.id || s._id
        if (id) {
          supplierById[id] = s
          supplierById[String(id)] = s
        }
      }
      const usageRows = (usageResult.data?.rows || []).map((u) => {
        const feed = feedById[u.feed_type_id]
        return {
          ...u,
          feed_types: feed ? { id: feed.id || feed._id, name: feed.name } : null,
        }
      })

      const purchasesData = (purchasesResult.data || []).map((p) => {
        const feed = feedById[p.feed_type_id] || feedById[String(p.feed_type_id)]
        const supplierId = p.supplier_id || p.supplierId
        const supplier =
          (supplierId &&
            (supplierById[supplierId] || supplierById[String(supplierId)])) ||
          null
        return {
          ...p,
          supplier_id: supplierId || null,
          feed_types: feed ? { id: feed.id || feed._id, name: feed.name } : null,
          feed_type: feed ? { name: feed.name } : null,
          suppliers: supplier
            ? { id: supplier.id || supplier._id, name: supplier.name }
            : null,
          supplier: supplier ? { name: supplier.name } : null,
        }
      })

      const lowStockData = (lowStockResult.data || [])
        .map((a) => ({
          id: a.feed_type_id || a.feedTypeId || a.id,
          name: a.name || a.feed_type_name || a.feedTypeName || 'Feed',
          current_stock: a.current_stock ?? a.currentStock ?? 0,
          minimum_stock: a.minimum_stock ?? a.minimumStock ?? 0,
          protein_percentage: a.protein_percentage ?? null,
          bag_size_kg: a.bag_size_kg ?? a.bagSizeKg ?? null,
        }))
        .filter((a) => Number(a.minimum_stock) > 0)

      setFeedTypes(feedTypesData)
      setPurchases(purchasesData)
      setLowStockAlerts(lowStockData)
      setFeedUsage(usageRows)
      setCages(cagesData)
      setSuppliers(suppliersData)

      const nextStats = calculateStats(purchasesData)
      const nextInventory = calculateInventoryMetrics(
        feedTypesData,
        purchasesData,
        usageRows,
      )
      nextStats.stockValue = nextInventory.stockValue
      setStats(nextStats)
      setCostAnalysis(calculateCostAnalysis(purchasesData, feedTypesData))
      setInventoryMetrics(nextInventory)
      setUsageAnalytics(
        calculateUsageAnalytics(purchasesData, usageRows, cagesData),
      )
      setSupplierMetrics(
        calculateSupplierMetrics(purchasesData, suppliersData),
      )
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
      const supplier =
        purchase.supplier?.name ||
        purchase.suppliers?.name ||
        'No supplier'
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
      const supplier =
        purchase.suppliers?.name ||
        purchase.supplier?.name ||
        'No supplier'
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
      reorderRecommendations: [],
    }

    const active = (feedTypes || []).filter((f) => f.active !== false)
    const maxStock = Math.max(
      ...active.map((f) => Number(f.current_stock) || 0),
      1,
    )

    metrics.stockLevels = active.map((feed) => {
      const current = Number(feed.current_stock) || 0
      const minimum = Number(feed.minimum_stock) || 0
      const bagSize = Number(feed.bag_size_kg || feed.bagSizeKg || 25)
      let status = 'ok'
      if (minimum > 0 && current <= minimum) status = 'critical'
      else if (minimum > 0 && current <= minimum * 1.2) status = 'low'
      else if (current <= 0) status = 'empty'
      const vsMinPct =
        minimum > 0 ? Math.round((current / minimum) * 100) : null
      return {
        id: feed.id || feed._id,
        name: feed.name,
        currentStock: current,
        minimumStock: minimum,
        bagSizeKg: bagSize,
        bagsOnHand:
          bagSize > 0 ? Math.round((current / bagSize) * 10) / 10 : null,
        protein: feed.protein_percentage ?? feed.protein_content ?? null,
        pricePerKg: Number(feed.price_per_kg) || 0,
        // Bar fill relative to largest stock so empty types don't look full
        barPct: Math.min(100, Math.round((current / maxStock) * 100)),
        vsMinPct,
        status,
      }
    })

    metrics.stockValue = active.reduce((total, feed) => {
      return (
        total +
        (Number(feed.current_stock) || 0) * (Number(feed.price_per_kg) || 0)
      )
    }, 0)

    const averageDailyUsage = {}
    ;(usage || []).forEach((record) => {
      const feedType = record.feed_types?.name
      if (!feedType) return
      if (!averageDailyUsage[feedType]) {
        averageDailyUsage[feedType] = { totalUsage: 0, days: 0 }
      }
      averageDailyUsage[feedType].totalUsage += record.quantity
      averageDailyUsage[feedType].days++
    })

    Object.entries(averageDailyUsage).forEach(([feedType, data]) => {
      const avgDailyUsage = data.totalUsage / data.days
      const feed = active.find((f) => f.name === feedType)
      if (feed && avgDailyUsage > 0) {
        metrics.daysRemaining[feedType] = Math.floor(
          (Number(feed.current_stock) || 0) / avgDailyUsage,
        )
      }
    })

    metrics.reorderRecommendations = active
      .filter((feed) => {
        const min = Number(feed.minimum_stock) || 0
        if (min <= 0) return false
        return (Number(feed.current_stock) || 0) <= min * 1.2
      })
      .map((feed) => {
        const current = Number(feed.current_stock) || 0
        const minimum = Number(feed.minimum_stock) || 0
        const bagSize = Number(feed.bag_size_kg || feed.bagSizeKg || 25)
        const recommendedOrder = Math.max(0, Math.ceil(minimum * 2 - current))
        return {
          id: feed.id || feed._id,
          name: feed.name,
          currentStock: current,
          minimumStock: minimum,
          bagSizeKg: bagSize,
          protein: feed.protein_percentage ?? feed.protein_content ?? null,
          recommendedOrder,
          recommendedBags:
            bagSize > 0
              ? Math.ceil(recommendedOrder / bagSize)
              : null,
        }
      })
      .filter((rec) => rec.recommendedOrder > 0)

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
      const supplier =
        purchase.suppliers?.name ||
        purchase.supplier?.name ||
        'No supplier'
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

      // No real delivery ETA yet — treat recorded purchases as completed on time
      supplierOrders[supplier].onTimeDeliveries++
    })

    // Convert supplier orders to reliability array
    metrics.reliability = Object.entries(supplierOrders).map(([supplier, data]) => ({
      supplier,
      reliability: (data.onTimeDeliveries / data.totalOrders) * 100,
      totalOrders: data.totalOrders,
      totalCost: data.totalCost,
      averagePrice:
        data.totalQuantity > 0 ? data.totalCost / data.totalQuantity : 0,
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

  const bagSizeKg = Number(formData.bag_size_kg) > 0 ? Number(formData.bag_size_kg) : 25

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => {
      const next = { ...prev, [name]: value }
      let size = Number(prev.bag_size_kg) > 0 ? Number(prev.bag_size_kg) : 25

      if (name === 'feed_type_id') {
        const ft = feedTypes.find((t) => (t.id || t._id) === value)
        size = Number(ft?.bag_size_kg || ft?.bagSizeKg || 25)
        next.bag_size_kg = String(size)
        if (next.quantity !== '') {
          const kg = parseFloat(next.quantity)
          if (!Number.isNaN(kg) && size > 0) {
            next.bags = String(Math.round((kg / size) * 1000) / 1000)
          }
        }
        const price = ft?.price_per_kg ?? ft?.pricePerKg
        if (price != null && (prev.price_per_kg === '' || prev.price_per_kg == null)) {
          next.price_per_kg = String(price)
        }
      }

      if (name === 'bag_size_kg') {
        size = Number(value) > 0 ? Number(value) : 25
        if (next.bags !== '') {
          const bags = parseFloat(next.bags)
          if (!Number.isNaN(bags)) {
            next.quantity = String(Math.round(bags * size * 1000) / 1000)
          }
        } else if (next.quantity !== '') {
          const kg = parseFloat(next.quantity)
          if (!Number.isNaN(kg) && size > 0) {
            next.bags = String(Math.round((kg / size) * 1000) / 1000)
          }
        }
      }

      if (name === 'bags' && value !== '') {
        const bags = parseFloat(value)
        if (!Number.isNaN(bags)) {
          next.quantity = String(Math.round(bags * size * 1000) / 1000)
        }
      }
      if (name === 'quantity' && value !== '') {
        const kg = parseFloat(value)
        if (!Number.isNaN(kg) && size > 0) {
          next.bags = String(Math.round((kg / size) * 1000) / 1000)
        }
      }
      return next
    })
  }

  const handleAddPurchase = () => {
    setFormData({
      feed_type_id: '',
      quantity: '',
      bags: '',
      bag_size_kg: '25',
      price_per_kg: '',
      purchase_date: new Date().toISOString().split('T')[0],
      supplier_id: '',
      batch_number: '',
      expiry_date: '',
      notes: '',
      locationId: activeLocationId || '',
    })
    setError('')
    setSuccess('')
    setShowAddModal(true)
  }

  const handleOrderFeed = (feedIdOrName) => {
    const ft = feedTypes.find(
      (t) =>
        (t.id || t._id) === feedIdOrName ||
        t.name === feedIdOrName,
    )
    const size = Number(ft?.bag_size_kg || ft?.bagSizeKg || 25)
    setFormData({
      feed_type_id: ft ? String(ft.id || ft._id) : '',
      quantity: '',
      bags: '',
      bag_size_kg: String(size > 0 ? size : 25),
      price_per_kg:
        ft?.price_per_kg != null ? String(ft.price_per_kg) : '',
      purchase_date: new Date().toISOString().split('T')[0],
      supplier_id: ft?.supplier_id || '',
      batch_number: '',
      expiry_date: '',
      notes: '',
      locationId: activeLocationId || '',
    })
    setError('')
    setSuccess('')
    setShowAddModal(true)
  }

  const handleEditPurchase = (purchase) => {
    setEditingPurchase(purchase)
    const qty = purchase.quantity
    const ft = feedTypes.find(
      (t) => (t.id || t._id) === purchase.feed_type_id,
    )
    const size = Number(ft?.bag_size_kg || ft?.bagSizeKg || 25)
    let bags = purchase.bags
    if (
      (bags == null || bags === '') &&
      qty != null &&
      size > 0
    ) {
      bags = Math.round((Number(qty) / size) * 1000) / 1000
    }
    setFormData({
      feed_type_id: purchase.feed_type_id,
      quantity: qty != null ? String(qty) : '',
      bags: bags != null && bags !== '' ? String(bags) : '',
      bag_size_kg: String(size),
      price_per_kg: purchase.price_per_kg,
      purchase_date: purchase.purchase_date,
      supplier_id: purchase.supplier_id || '',
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
      if (!formData.feed_type_id || !formData.price_per_kg) {
        throw new Error('Please fill in all required fields')
      }
      if (
        (!formData.quantity || parseFloat(formData.quantity) <= 0) &&
        (!formData.bags || parseFloat(formData.bags) <= 0)
      ) {
        throw new Error('Enter bags or quantity (kg)')
      }

      const purchaseData = {
        feed_type_id: formData.feed_type_id,
        quantity:
          formData.quantity !== '' && formData.quantity != null
            ? parseFloat(formData.quantity)
            : undefined,
        bags:
          formData.bags !== '' && formData.bags != null
            ? parseFloat(formData.bags)
            : undefined,
        price_per_kg: parseFloat(formData.price_per_kg),
        purchase_date:
          formData.purchase_date || new Date().toISOString().split('T')[0],
        supplier_id: formData.supplier_id || undefined,
        batch_number: formData.batch_number || undefined,
        expiry_date: formData.expiry_date || undefined,
        notes: formData.notes || undefined,
        locationId: formData.locationId || activeLocationId || undefined,
      }

      const { error } = await feedService.createPurchase(purchaseData)
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
      if (
        (!formData.quantity || parseFloat(formData.quantity) <= 0) &&
        (!formData.bags || parseFloat(formData.bags) <= 0)
      ) {
        throw new Error('Enter bags or quantity (kg)')
      }
      const { error } = await feedService.updatePurchase(editingPurchase.id, {
        ...formData,
        quantity:
          formData.quantity !== '' && formData.quantity != null
            ? parseFloat(formData.quantity)
            : undefined,
        bags:
          formData.bags !== '' && formData.bags != null
            ? parseFloat(formData.bags)
            : undefined,
        price_per_kg:
          formData.price_per_kg !== '' && formData.price_per_kg != null
            ? parseFloat(formData.price_per_kg)
            : undefined,
      })
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

  const handleDeletePurchase = async () => {
    const id = deleteConfirm?.id || deleteConfirm?._id
    if (!id) return
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
    <Layout title="Feed Purchases">
      <div data-tour="page-feed-purchases">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Feed', href: '/feed-management/overview' },
          { label: 'Purchases' },
        ]}
        description="Record and analyze feed purchases, stock alerts, and spend."
        related={[
          { label: 'Feed types', href: '/feed-types' },
          { label: 'Feed suppliers', href: '/feed-suppliers' },
          { label: 'Stock levels', href: '/stock-levels' },
          { label: 'Issue feed', href: '/feed-issue' },
        ]}
        actions={
          <button
            onClick={handleAddPurchase}
            className="inline-flex items-center px-3 py-2 text-sm font-semibold rounded-xl text-white bg-lagoon-950 hover:bg-lagoon-800 min-h-10"
          >
            <Plus className="w-4 h-4 mr-2" />
            Record Purchase
          </button>
        }
      />

        {/* Time Range Selector */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            Spend &amp; usage window
          </p>
          <div
            className="inline-flex rounded-xl border border-foam-deep bg-surface p-1"
            role="group"
            aria-label="Time range"
          >
            {['7d', '30d', '90d', '1y'].map((range) => (
              <button
                key={range}
                type="button"
                onClick={() => setTimeRange(range)}
                className={`min-h-9 cursor-pointer rounded-lg px-3 text-sm font-medium transition-colors duration-200 ${
                  timeRange === range
                    ? 'bg-lagoon-800 text-white shadow-sm'
                    : 'text-muted hover:bg-foam-deep/50 hover:text-chart-ink'
                }`}
              >
                {range}
              </button>
            ))}
          </div>
        </div>

        {/* Low Stock Alerts */}
        {lowStockAlerts.length > 0 ? (
          <div className="mb-6 overflow-hidden rounded-2xl border border-signal/30 bg-signal/10">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-signal/20 px-5 py-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-signal/20">
                  <AlertTriangle className="h-5 w-5 text-signal" aria-hidden />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-chart-ink">
                    Low stock · {lowStockAlerts.length}{' '}
                    {lowStockAlerts.length === 1 ? 'type' : 'types'}
                  </h3>
                  <p className="mt-0.5 text-xs text-muted">
                    Below configured minimum — record a purchase or raise mins on feed types.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleAddPurchase}
                className="min-h-10 cursor-pointer rounded-xl bg-lagoon-800 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-lagoon-950"
              >
                Record purchase
              </button>
            </div>
            <ul className="grid gap-2 p-3 sm:grid-cols-2 xl:grid-cols-3">
              {lowStockAlerts.map((feed) => (
                <li
                  key={feed.id || feed.name}
                  className="flex items-center justify-between gap-3 rounded-xl border border-foam-deep/80 bg-surface/80 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-chart-ink">
                      {feed.name}
                    </p>
                    <p className="font-data text-xs text-muted">
                      {formatWeight(feed.current_stock)} · min{' '}
                      {formatWeight(feed.minimum_stock)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleOrderFeed(feed.id || feed.name)}
                    className="shrink-0 cursor-pointer rounded-lg border border-lagoon-800/40 px-2.5 py-1.5 text-xs font-semibold text-chart-ink transition-colors hover:bg-foam-deep/50"
                  >
                    Order
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-kelp/25 bg-kelp/10 px-5 py-3.5">
            <div className="flex items-center gap-3">
              <Package className="h-5 w-5 shrink-0 text-kelp" aria-hidden />
              <p className="text-sm text-chart-ink">
                No low-stock alerts
                <span className="text-muted">
                  {' '}
                  — set <span className="text-chart-ink">Minimum stock (kg)</span> on each
                  feed type.
                </span>
              </p>
            </div>
            <a
              href="/feed-types"
              className="min-h-9 shrink-0 cursor-pointer rounded-lg border border-kelp/40 bg-surface px-3 py-1.5 text-xs font-semibold text-chart-ink transition-colors hover:bg-foam-deep/40"
            >
              Open feed types
            </a>
          </div>
        )}

        {/* Stats Cards */}
        <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            {
              label: 'Total cost',
              value: formatCurrency(stats.totalCost),
              icon: DollarSign,
              tone: 'bg-foam-deep text-lagoon-800',
            },
            {
              label: 'Quantity bought',
              value: formatWeight(stats.totalQuantity),
              icon: Package,
              tone: 'bg-kelp/15 text-kelp',
            },
            {
              label: 'Avg. cost / kg',
              value: formatCurrency(stats.averageCostPerKg),
              icon: BarChart2,
              tone: 'bg-foam-deep text-lagoon-800',
            },
            {
              label: 'Stock on hand',
              value: formatCurrency(stats.stockValue),
              icon: Database,
              tone: 'bg-foam-deep text-lagoon-800',
            },
          ].map((card) => (
            <div
              key={card.label}
              className="page-card flex items-center gap-3 p-4 transition-shadow duration-200 hover:shadow-md"
            >
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${card.tone}`}
              >
                <card.icon className="h-5 w-5" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">
                  {card.label}
                </p>
                <p className="truncate font-data text-lg font-semibold text-chart-ink sm:text-xl">
                  {card.value}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Cost Analysis Section */}
        <div className="page-card mb-6 p-5">
          <h2 className="mb-4 text-base font-semibold text-chart-ink">Cost analysis</h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Cost Trends Chart */}
            <div className="rounded-xl border border-foam-deep bg-surface p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Cost trends</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsLineChart data={costAnalysis.costTrends}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--foam-deep)" />
                    <XAxis dataKey="month" tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                    <YAxis tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="cost" stroke="var(--lagoon-800)" strokeWidth={2} />
                  </RechartsLineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Supplier Comparison Chart */}
            <div className="rounded-xl border border-foam-deep bg-surface p-4">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Supplier price</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsBarChart data={costAnalysis.supplierComparison}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--foam-deep)" />
                    <XAxis dataKey="supplier" tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                    <YAxis tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="averagePrice" fill="var(--kelp)" radius={[4, 4, 0, 0]} />
                  </RechartsBarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>

        {/* Inventory Management Section */}
        <div className="page-card mb-6 overflow-hidden">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-foam-deep px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-chart-ink">
                Inventory
              </h2>
              <p className="mt-0.5 text-xs text-muted">
                Stock vs peers · bag size · protein · reorder only when a minimum is set
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-[11px] text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-kelp" /> OK
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500" /> Near min
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-signal" /> Below min
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-muted/50" /> Empty / no min
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 divide-y divide-foam-deep lg:grid-cols-5 lg:divide-x lg:divide-y-0">
            {/* Stock Levels */}
            <div className="p-4 lg:col-span-3">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
                Current stock
              </h3>
              {inventoryMetrics.stockLevels.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted">
                  No feed types yet.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {inventoryMetrics.stockLevels.map((stock) => {
                    const barTone =
                      stock.status === 'critical'
                        ? 'bg-signal'
                        : stock.status === 'low'
                          ? 'bg-amber-500'
                          : stock.status === 'empty'
                            ? 'bg-muted/40'
                            : 'bg-kelp'
                    return (
                      <li
                        key={stock.id || stock.name}
                        className="rounded-xl border border-foam-deep/70 bg-surface px-3 py-2.5 transition-colors duration-200 hover:border-foam-deep"
                      >
                        <div className="mb-1.5 flex items-baseline justify-between gap-3">
                          <div className="min-w-0">
                            <span className="text-sm font-medium text-chart-ink">
                              {stock.name}
                            </span>
                            <span className="ml-2 text-[11px] text-muted">
                              {stock.protein != null ? `${stock.protein}% protein` : 'Protein —'}
                              {' · '}
                              {stock.bagSizeKg}kg bags
                              {stock.bagsOnHand != null
                                ? ` · ~${stock.bagsOnHand} bags`
                                : ''}
                            </span>
                          </div>
                          <span className="shrink-0 font-data text-sm font-semibold text-chart-ink">
                            {formatWeight(stock.currentStock)}
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-foam-deep">
                          <div
                            className={`h-full rounded-full transition-[width] duration-300 ${barTone}`}
                            style={{ width: `${Math.max(stock.barPct, stock.currentStock > 0 ? 4 : 0)}%` }}
                          />
                        </div>
                        <div className="mt-1 flex justify-between text-[11px] text-muted">
                          <span>
                            {stock.minimumStock > 0
                              ? `Min ${formatWeight(stock.minimumStock)}${
                                  stock.vsMinPct != null
                                    ? ` · ${stock.vsMinPct}% of min`
                                    : ''
                                }`
                              : 'No minimum set'}
                          </span>
                          <span>{formatCurrency(stock.pricePerKg)}/kg</span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            {/* Reorder Recommendations */}
            <div className="bg-foam-deep/20 p-4 lg:col-span-2">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
                Reorder
              </h3>
              {inventoryMetrics.reorderRecommendations.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-foam-deep px-4 py-10 text-center">
                  <Package className="mb-2 h-8 w-8 text-muted/60" aria-hidden />
                  <p className="text-sm font-medium text-chart-ink">
                    Nothing to reorder
                  </p>
                  <p className="mt-1 max-w-[16rem] text-xs text-muted">
                    Recommendations appear when stock is at or near a configured minimum.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2.5">
                  {inventoryMetrics.reorderRecommendations.map((rec) => (
                    <li
                      key={rec.id || rec.name}
                      className="rounded-xl border border-amber-500/25 bg-surface p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-chart-ink">
                            {rec.name}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted">
                            {formatWeight(rec.currentStock)} on hand · min{' '}
                            {formatWeight(rec.minimumStock)}
                            {rec.protein != null ? ` · ${rec.protein}%` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <p className="font-data text-xs text-muted">
                          Suggest {formatWeight(rec.recommendedOrder)}
                          {rec.recommendedBags != null
                            ? ` (~${rec.recommendedBags}×${rec.bagSizeKg}kg)`
                            : ''}
                        </p>
                        <button
                          type="button"
                          onClick={() => handleOrderFeed(rec.id || rec.name)}
                          className="min-h-9 shrink-0 cursor-pointer rounded-lg bg-lagoon-800 px-3 text-xs font-semibold text-white transition-colors duration-200 hover:bg-lagoon-950"
                        >
                          Order
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Usage Analytics Section */}
        <div className="page-card p-6 mb-6">
          <h2 className="text-lg font-medium text-chart-ink mb-4">Usage Analytics</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Cage Usage Chart */}
            <div className="bg-white rounded-lg p-4">
              <h3 className="text-sm font-medium text-chart-ink mb-4">Feed Usage by Cage</h3>
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
              <h3 className="text-sm font-medium text-chart-ink mb-4">FCR by Feed Type</h3>
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
        <div className="page-card mb-6 overflow-hidden">
          <div className="border-b border-foam-deep px-5 py-4">
            <h2 className="text-base font-semibold text-chart-ink">
              Supplier performance
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Based on recorded purchases. “No supplier” means the purchase was saved without a supplier selected — edit the purchase to assign one.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-0 lg:grid-cols-2 lg:divide-x lg:divide-foam-deep">
            {/* Supplier Reliability */}
            <div className="p-5">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
                Order volume
              </h3>
              <div className="space-y-3">
                {supplierMetrics.reliability && supplierMetrics.reliability.length > 0 ? (
                  supplierMetrics.reliability.map((metric, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between gap-3 rounded-xl border border-foam-deep/70 bg-surface px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="text-sm font-medium text-chart-ink">
                          {metric.supplier}
                        </span>
                        <p className="text-xs text-muted">
                          {metric.totalOrders}{' '}
                          {metric.totalOrders === 1 ? 'order' : 'orders'}
                          {' · '}
                          {formatCurrency(metric.totalCost || 0)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-foam-deep">
                          <div
                            className="h-full rounded-full bg-kelp"
                            style={{
                              width: `${Math.min(metric.reliability, 100)}%`,
                            }}
                          />
                        </div>
                        <span className="w-12 text-right font-data text-xs text-muted">
                          {metric.reliability.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="py-6 text-center text-sm text-muted">
                    No supplier data yet — record purchases with a supplier selected.
                  </p>
                )}
              </div>
            </div>

            {/* Price Comparison */}
            <div className="p-5">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">
                Price comparison
              </h3>
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
                  <div className="h-full flex items-center justify-center text-sm text-muted">
                    No price comparison data available
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Purchases Table */}
        <div className="page-card overflow-hidden">
          <div className="px-6 py-4 border-b border-foam-deep">
            <h2 className="font-medium text-chart-ink">Recent Purchases</h2>
          </div>

          {loading ? (
            <div className="py-12 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-lagoon-800 mx-auto"></div>
              <p className="mt-3 text-muted">Loading purchases...</p>
            </div>
          ) : purchases.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-foam-deep">
                <thead className="bg-foam-deep/40">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Feed Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Quantity
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Bags
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Price/kg
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Total Cost
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Purchase Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Supplier
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Batch Number
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-foam-deep">
                  {purchases.map((purchase) => (
                    <tr key={purchase.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-chart-ink">
                        {purchase.feed_types?.name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted font-data">
                        {purchase.quantity} kg
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted font-data">
                        {purchase.bags != null
                          ? `${purchase.bags} bags`
                          : '—'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                        {formatCurrency(purchase.price_per_kg)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                        {formatCurrency(purchase.quantity * purchase.price_per_kg)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                        {new Date(purchase.purchase_date).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                        {purchase.suppliers?.name ||
                          purchase.supplier?.name ||
                          '—'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                        {purchase.batch_number || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-muted">
                        <div className="flex space-x-3">
                          <button
                            onClick={() => handleEditPurchase(purchase)}
                            className="text-lagoon-800 hover:text-lagoon-950"
                            title="Edit Purchase"
                          >
                            <Edit className="w-4 h-4" />
                          </button>

                          <button
                            type="button"
                            onClick={() => setDeleteConfirm(purchase)}
                            className="text-red-600 hover:text-red-800"
                            title="Delete Purchase"
                          >
                            <Trash className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center">
              <AlertCircle className="h-12 w-12 text-muted mx-auto" />
              <p className="mt-3 text-muted">
                No purchases found. Record your first purchase to get started.
              </p>
            </div>
          )}
        </div>

      {/* Add Purchase Modal */}
      {showAddModal && (
        <div className="fixed inset-0 overflow-y-auto z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 modal-backdrop"
            onClick={() => setShowAddModal(false)}
          ></div>
          <div className="relative bg-white rounded-lg max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-medium text-chart-ink mb-4">
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
              <FeedTypeField
                id="add-feed-type"
                name="feed_type_id"
                value={formData.feed_type_id}
                onChange={handleChange}
                feedTypes={feedTypes}
                ready={!loading}
                required
                showStock={false}
                offerPurchaseCreate={false}
                hint="Catalog product this purchase adds stock to. Create one if the list is empty."
                emptyMessage="Add a feed type before recording a purchase."
                onFeedTypesChanged={fetchData}
                onCreated={(result) => {
                  fetchData()
                  if (result?.id) {
                    const size = Number(
                      result.bag_size_kg || result.bagSizeKg || 25,
                    )
                    setFormData((prev) => ({
                      ...prev,
                      feed_type_id: result.id,
                      bag_size_kg: String(size > 0 ? size : 25),
                    }))
                  }
                }}
              />

              <BagSizeField
                id="add-bag-size"
                value={formData.bag_size_kg}
                onChange={handleChange}
              />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-chart-ink mb-1">
                    Bags
                  </label>
                  <input
                    type="number"
                    name="bags"
                    value={formData.bags}
                    onChange={handleChange}
                    step="0.01"
                    min="0"
                    className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm font-data"
                    placeholder="e.g. 40"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-chart-ink mb-1">
                    Quantity (kg) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    name="quantity"
                    value={formData.quantity}
                    onChange={handleChange}
                    step="0.01"
                    min="0"
                    className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm font-data"
                    required
                  />
                  <p className="mt-1 text-xs text-muted">
                    At {bagSizeKg} kg/bag — enter bags or kg; the other updates.
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Price per kg (₵) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  name="price_per_kg"
                  value={formData.price_per_kg}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Purchase Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  name="purchase_date"
                  value={formData.purchase_date}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Supplier
                </label>
                <select
                  name="supplier_id"
                  value={formData.supplier_id || ''}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                >
                  <option value="">Select supplier (optional)</option>
                  {suppliers.map((supplier) => (
                    <option
                      key={supplier.id || supplier._id}
                      value={supplier.id || supplier._id}
                    >
                      {supplier.name}
                    </option>
                  ))}
                </select>
                {suppliers.length === 0 && (
                  <p className="mt-1 text-xs text-muted">
                    No suppliers yet — add one under Feed suppliers.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Batch Number
                </label>
                <input
                  type="text"
                  name="batch_number"
                  value={formData.batch_number}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Expiry Date
                </label>
                <input
                  type="date"
                  name="expiry_date"
                  value={formData.expiry_date}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Farm location <span className="text-red-500">*</span>
                </label>
                <FarmLocationSelect
                  name="locationId"
                  value={formData.locationId}
                  onChange={handleChange}
                  required
                  allowEmpty={false}
                />
                <p className="mt-1 text-xs text-muted">
                  Defaults to the location selected in the header
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Notes
                </label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleChange}
                  rows={3}
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 border border-input-border rounded-md shadow-sm text-sm font-medium text-chart-ink bg-white hover:bg-foam-deep/40"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-lagoon-800 hover:bg-lagoon-950"
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
            className="fixed inset-0 modal-backdrop"
            onClick={() => setShowEditModal(false)}
          ></div>
          <div className="relative bg-white rounded-lg max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-medium text-chart-ink mb-4">
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
              <FeedTypeField
                id="edit-feed-type"
                name="feed_type_id"
                value={formData.feed_type_id}
                onChange={handleChange}
                feedTypes={feedTypes}
                ready={!loading}
                required
                showStock={false}
                offerPurchaseCreate={false}
                hint="Catalog product this purchase adds stock to. Create one if the list is empty."
                emptyMessage="Add a feed type before recording a purchase."
                onFeedTypesChanged={fetchData}
                onCreated={(result) => {
                  fetchData()
                  if (result?.id) {
                    const size = Number(
                      result.bag_size_kg || result.bagSizeKg || 25,
                    )
                    setFormData((prev) => ({
                      ...prev,
                      feed_type_id: result.id,
                      bag_size_kg: String(size > 0 ? size : 25),
                    }))
                  }
                }}
              />

              <BagSizeField
                id="edit-bag-size"
                value={formData.bag_size_kg}
                onChange={handleChange}
              />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-chart-ink mb-1">
                    Bags
                  </label>
                  <input
                    type="number"
                    name="bags"
                    value={formData.bags}
                    onChange={handleChange}
                    step="0.01"
                    min="0"
                    className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm font-data"
                    placeholder="e.g. 40"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-chart-ink mb-1">
                    Quantity (kg) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    name="quantity"
                    value={formData.quantity}
                    onChange={handleChange}
                    step="0.01"
                    min="0"
                    className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm font-data"
                    required
                  />
                  <p className="mt-1 text-xs text-muted">
                    At {bagSizeKg} kg/bag — enter bags or kg; the other updates.
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Price per kg (₵) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  name="price_per_kg"
                  value={formData.price_per_kg}
                  onChange={handleChange}
                  step="0.01"
                  min="0"
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Purchase Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  name="purchase_date"
                  value={formData.purchase_date}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Supplier
                </label>
                <select
                  name="supplier_id"
                  value={formData.supplier_id || ''}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                >
                  <option value="">Select supplier (optional)</option>
                  {suppliers.map((supplier) => (
                    <option
                      key={supplier.id || supplier._id}
                      value={supplier.id || supplier._id}
                    >
                      {supplier.name}
                    </option>
                  ))}
                </select>
                {suppliers.length === 0 && (
                  <p className="mt-1 text-xs text-muted">
                    No suppliers yet — add one under Feed suppliers.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Batch Number
                </label>
                <input
                  type="text"
                  name="batch_number"
                  value={formData.batch_number}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Expiry Date
                </label>
                <input
                  type="date"
                  name="expiry_date"
                  value={formData.expiry_date}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Notes
                </label>
                <textarea
                  name="notes"
                  value={formData.notes}
                  onChange={handleChange}
                  rows={3}
                  className="block w-full px-3 py-2 border border-input-border rounded-md shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="px-4 py-2 border border-input-border rounded-md shadow-sm text-sm font-medium text-chart-ink bg-white hover:bg-foam-deep/40"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-lagoon-800 hover:bg-lagoon-950"
                >
                  <Save className="w-4 h-4 mr-2 inline-block" />
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDeleteModal
        open={Boolean(deleteConfirm)}
        title="Delete purchase"
        message={
          <>
            Delete this purchase
            {deleteConfirm?.feed_types?.name
              ? ` of ${deleteConfirm.feed_types.name}`
              : ''}
            ? Stock will be adjusted accordingly.
          </>
        }
        onCancel={() => setDeleteConfirm(null)}
        onConfirm={handleDeletePurchase}
      />
    </div>
    </Layout>
  )
} 