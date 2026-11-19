import { useState, useEffect, useMemo } from 'react'
import { useMutation, useQuery } from 'convex/react'
import {
  Plus,
  Edit,
  Trash,
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
  ChevronUp,
  Clock,
  Layers,
} from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import {
  Button,
  Field,
  GhostButton,
  GradientButton,
  Input,
  KpiStrip,
  Select,
  Segmented,
  Textarea,
  LoadingState,
  Modal,
} from '../components/ui'
import FeedTypeField from '../components/FeedTypeField'
import BagSizeField, {
  DEFAULT_BAG_SIZE_KG,
  resolveBagSizeKg,
} from '../components/BagSizeField'
import ConfirmDeleteModal from '../components/ConfirmDeleteModal'
import FeedPurchaseModal from '../components/FeedPurchaseModal'
import { useToast } from '../components/Toast'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { api } from '../convex/_generated/api'
import { purchaseUpdateArgs } from '../lib/feedData'
import { useFeedUsageStats } from '../hooks/useFeedData'
import { useOptionalQuery } from '../hooks/useOptionalQuery'
import { errorMessage } from '../lib/errorMessage'
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
import { localToday } from '../lib/format'
import { usePermission } from '../hooks/usePermission'
import NavTabs from '../components/ui/NavTabs'
import { Panel, ListRow } from '../components/ui/Panel'
import { feedTabs } from '../lib/sectionTabs'
import { useT } from '../lib/i18n/context'

export default function FeedPurchasesPage() {
  return (
    <ProtectedRoute>
      <FeedPurchases />
    </ProtectedRoute>
  )
}

function FeedPurchases() {
  const t = useT()
  const canRecord = usePermission('inventory.purchase.record')
  const { showToast } = useToast()
  const { hasRole } = useAuth()
  // Purchase edit and void are admin-only on the backend.
  const isAdmin = usePermission('inventory.purchase.correct')
  const { activeLocationId, activeLocation, locations, locationArgs } = useLocation()

  const [feedTypes, setFeedTypes] = useState([])
  const [purchases, setPurchases] = useState([])
  const [showAddModal, setShowAddModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)
  const [purchaseDefaultFeedTypeId, setPurchaseDefaultFeedTypeId] = useState('')
  const [editingPurchase, setEditingPurchase] = useState(null)
  const [formData, setFormData] = useState({
    feed_type_id: '',
    quantity: '',
    bags: '',
    bag_size_kg: '20',
    price_per_kg: '',
    purchase_date: localToday(),
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
    totalBags: 0,
    avgFeedAgeDays: null,
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
    fcrByCage: [],
    farmEfcr: null,
    efficiencyMetrics: {},
    historicalTrends: []
  })
  const [supplierMetrics, setSupplierMetrics] = useState({
    reliability: [],
    priceComparison: [],
    unassigned: null,
    deliveryPerformance: {},
    qualityMetrics: {}
  })

  const feedTypesResult = useQuery(api.feed.listFeedTypes, {})
  const purchasesResult = useQuery(api.feed.listPurchases, locationArgs)
  const lotsResult = useQuery(api.inventory.listLots, locationArgs)
  const stockLevelsResult = useQuery(api.inventory.listStockLevels, locationArgs)
  const usageResult = useFeedUsageStats(timeRange)
  const cagesResult = useQuery(api.cages.list, locationArgs)
  const suppliersResult = useQuery(api.feed.listSuppliers, {})
  const asOf = useMemo(() => localToday(), [])
  const growth = useOptionalQuery(api.cages.growthAll, { ...locationArgs, asOf }, null)
  const updatePurchase = useMutation(api.feed.updatePurchase)
  const voidPurchase = useMutation(api.feed.voidPurchase)
  const loading = [
    feedTypesResult,
    purchasesResult,
    lotsResult,
    stockLevelsResult,
    usageResult,
    cagesResult,
    suppliersResult,
    growth,
  ].some((r) => r === undefined)

  // Derived views recompute whenever a live query or the site changes.
  useEffect(() => {
    if (loading) return
    applyData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    loading,
    feedTypesResult,
    purchasesResult,
    lotsResult,
    stockLevelsResult,
    usageResult,
    cagesResult,
    suppliersResult,
    growth,
    activeLocationId,
    locations,
  ])

  const applyData = () => {
      const feedTypesData = feedTypesResult || []
      const suppliersData = suppliersResult || []
      const cagesData = cagesResult || []
      const lotsData = lotsResult || []
      const stockLevelsData = stockLevelsResult || []
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
      const usageRows = (usageResult?.rows || []).map((u) => {
        const feed = feedById[u.feed_type_id]
        return {
          ...u,
          feed_types: feed ? { id: feed.id || feed._id, name: feed.name } : null,
        }
      })

      const mapPurchase = (p) => {
        const feed = feedById[p.feed_type_id] || feedById[String(p.feed_type_id)]
        const supplierId = p.supplier_id || p.supplierId || null
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
      }

      const purchasesData = (purchasesResult || []).map(mapPurchase)

      const lowStockData = (stockLevelsData || [])
        .map((a) => ({
          id: a.feed_type_id || a.feedTypeId || a.id,
          name: a.feed_type_name || a.feedTypeName || a.name || 'Feed',
          current_stock: a.current_stock ?? a.currentStock ?? 0,
          minimum_stock: a.minimum_stock ?? a.minimumStock ?? 0,
          protein_percentage: a.protein_percentage ?? null,
          bag_size_kg: a.bag_size_kg ?? a.bagSizeKg ?? null,
        }))
        .filter((a) => {
          const min = Number(a.minimum_stock) || 0
          if (min <= 0) return false
          return (Number(a.current_stock) || 0) <= min
        })

      setFeedTypes(feedTypesData)
      setPurchases(purchasesData)
      setLowStockAlerts(lowStockData)
      setFeedUsage(usageRows)
      setCages(cagesData)
      setSuppliers(suppliersData)

      // KPIs are scoped to the active header location
      const nextStats = calculateStats(purchasesData)
      const nextInventory = calculateInventoryMetrics(
        feedTypesData,
        purchasesData,
        usageRows,
        lotsData,
        {
          locations: locations || [],
          activeLocation,
          activeLocationId,
          stockLevels: stockLevelsData,
        },
      )
      nextStats.stockValue = nextInventory.stockValue
      nextStats.totalBags = nextInventory.totalBags
      nextStats.avgFeedAgeDays = nextInventory.avgFeedAgeDays
      setStats(nextStats)
      setCostAnalysis(calculateCostAnalysis(purchasesData, feedTypesData))
      setInventoryMetrics(nextInventory)
      setUsageAnalytics({
        ...calculateUsageAnalytics(purchasesData, usageRows, cagesData),
        // eFCR per cage for the current cycle (feed ÷ biomass gained)
        fcrByCage: (growth?.cages || [])
          .filter((g) => g.efcr != null)
          .map((g) => ({ cage: g.cage_name, efcr: g.efcr }))
          .sort((a, b) => b.efcr - a.efcr),
        farmEfcr: growth?.farm_efcr ?? null,
      })
      setSupplierMetrics(
        calculateSupplierMetrics(purchasesData, suppliersData),
      )
  }

  const calculateStats = (purchases) => {
    const stats = {
      totalPurchases: 0,
      totalCost: 0,
      totalQuantity: 0,
      averageCostPerKg: 0,
      feedTypeDistribution: [],
      supplierDistribution: [],
      monthlyUsage: [],
      stockValue: 0,
      totalBags: 0,
      avgFeedAgeDays: null,
    }

    if (!purchases || !Array.isArray(purchases)) {
      return stats
    }

    const monthlyMap = new Map()
    const feedTypeMap = new Map()
    const supplierMap = new Map()

    purchases.forEach(purchase => {
      stats.totalPurchases += 1
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
        null
      if (supplier) {
        supplierMap.set(supplier, (supplierMap.get(supplier) || 0) + purchase.quantity)
      }
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
    purchases.forEach((purchase) => {
      const supplier =
        purchase.suppliers?.name || purchase.supplier?.name || null
      if (!supplier) return
      if (!supplierCosts[supplier]) {
        supplierCosts[supplier] = {
          totalCost: 0,
          totalQuantity: 0,
          averagePrice: 0,
        }
      }
      supplierCosts[supplier].totalCost +=
        purchase.quantity * purchase.price_per_kg
      supplierCosts[supplier].totalQuantity += purchase.quantity
    })

    analysis.supplierComparison = Object.entries(supplierCosts).map(([supplier, data]) => ({
      supplier,
      averagePrice: data.totalCost / data.totalQuantity,
      totalQuantity: data.totalQuantity
    }))

    return analysis
  }

  const calculateInventoryMetrics = (
    feedTypes,
    purchases,
    usage,
    lots = [],
    locationContext = {},
  ) => {
    const metrics = {
      stockLevels: [],
      stockValue: 0,
      totalBags: 0,
      avgFeedAgeDays: null,
      daysRemaining: {},
      reorderRecommendations: [],
    }

    const active = (feedTypes || []).filter((f) => f.active !== false)
    const feedById = Object.fromEntries(
      active.map((f) => [String(f.id || f._id), f]),
    )
    const locationNameById = Object.fromEntries(
      (locationContext.locations || []).map((l) => [
        String(l.id || l._id),
        l.name,
      ]),
    )
    const fallbackLocationName =
      locationContext.activeLocation?.name ||
      (locationContext.activeLocationId &&
        locationNameById[String(locationContext.activeLocationId)]) ||
      'All locations'

    const resolveLocationLabel = (lot) => {
      const id = lot.location_id || lot.locationId
      if (id && locationNameById[String(id)]) {
        return locationNameById[String(id)]
      }
      return (lot.location || '').trim() || fallbackLocationName
    }

    // Prefer lot-based per-location stock when lots exist
    const lotRows = []
    const qtyByFeedLocation = new Map()
    for (const lot of lots || []) {
      const ftId = String(lot.feed_type_id || lot.feedTypeId || '')
      if (!ftId || !feedById[ftId]) continue
      const locLabel = resolveLocationLabel(lot)
      const key = `${ftId}::${locLabel}`
      const kg = Number(lot.quantity_kg ?? lot.quantityKg ?? 0)
      if (kg <= 0) continue
      qtyByFeedLocation.set(key, (qtyByFeedLocation.get(key) || 0) + kg)
    }

    if (qtyByFeedLocation.size > 0) {
      for (const [key, current] of qtyByFeedLocation.entries()) {
        const sep = key.indexOf('::')
        const ftId = key.slice(0, sep)
        const locLabel = key.slice(sep + 2)
        const feed = feedById[ftId]
        if (!feed) continue
        lotRows.push({ feed, current, location: locLabel })
      }
      // Include zero-stock active types so empties still appear
      for (const feed of active) {
        const ftId = String(feed.id || feed._id)
        const hasAny = [...qtyByFeedLocation.keys()].some((k) =>
          k.startsWith(`${ftId}::`),
        )
        if (!hasAny) {
          lotRows.push({
            feed,
            current: 0,
            location: fallbackLocationName,
          })
        }
      }
    } else {
      // Per-location stock from listStockLevels (not company-wide feedTypes.currentStock)
      const stockByFeed = Object.fromEntries(
        (locationContext.stockLevels || []).map((row) => [
          String(row.feed_type_id || row.feedTypeId),
          Number(row.current_stock ?? row.currentStock ?? 0),
        ]),
      )
      for (const feed of active) {
        const ftId = String(feed.id || feed._id)
        lotRows.push({
          feed,
          current: stockByFeed[ftId] ?? 0,
          location: fallbackLocationName,
        })
      }
    }

    const maxStock = Math.max(...lotRows.map((r) => r.current), 1)

    metrics.stockLevels = lotRows
      .map(({ feed, current, location }) => {
        const minimum = Number(feed.minimum_stock) || 0
        const bagSize = Number(feed.bag_size_kg || feed.bagSizeKg || 25)
        let status = 'ok'
        if (minimum > 0 && current <= minimum) status = 'critical'
        else if (minimum > 0 && current <= minimum * 1.2) status = 'low'
        else if (current <= 0) status = 'empty'
        const vsMinPct =
          minimum > 0 ? Math.round((current / minimum) * 100) : null
        const bagsOnHand =
          bagSize > 0 ? Math.round((current / bagSize) * 10) / 10 : null
        return {
          id: `${feed.id || feed._id}::${location}`,
          feedTypeId: feed.id || feed._id,
          name: feed.name,
          location,
          currentStock: current,
          minimumStock: minimum,
          bagSizeKg: bagSize,
          bagsOnHand,
          protein: feed.protein_percentage ?? feed.protein_content ?? null,
          pricePerKg: Number(feed.price_per_kg) || 0,
          barPct: Math.min(100, Math.round((current / maxStock) * 100)),
          vsMinPct,
          status,
        }
      })
      .sort((a, b) => {
        const byLoc = (a.location || '').localeCompare(b.location || '')
        if (byLoc) return byLoc
        return (a.name || '').localeCompare(b.name || '')
      })

    metrics.stockValue = metrics.stockLevels.reduce((total, row) => {
      return total + (Number(row.currentStock) || 0) * (Number(row.pricePerKg) || 0)
    }, 0)

    metrics.totalBags = metrics.stockLevels.reduce((sum, row) => {
      return sum + (Number(row.bagsOnHand) || 0)
    }, 0)

    // Weighted average age of on-hand lots at this location
    const now = Date.now()
    let weightedAgeDays = 0
    let ageWeightKg = 0
    for (const lot of lots || []) {
      const kg = Number(lot.quantity_kg ?? lot.quantityKg ?? 0)
      if (kg <= 0) continue
      const created = Number(lot.created_at ?? lot._creationTime)
      if (!Number.isFinite(created) || created <= 0) continue
      const ageDays = Math.max(0, (now - created) / (1000 * 60 * 60 * 24))
      weightedAgeDays += ageDays * kg
      ageWeightKg += kg
    }
    if (ageWeightKg > 0) {
      metrics.avgFeedAgeDays = Math.round((weightedAgeDays / ageWeightKg) * 10) / 10
    } else if ((purchases || []).length > 0) {
      // Fallback: age from purchase dates weighted by remaining stock proxy (qty bought)
      let w = 0
      let q = 0
      for (const p of purchases) {
        const qty = Number(p.quantity) || 0
        if (qty <= 0 || !p.purchase_date) continue
        const purchasedAt = new Date(p.purchase_date).getTime()
        if (!Number.isFinite(purchasedAt)) continue
        const ageDays = Math.max(0, (now - purchasedAt) / (1000 * 60 * 60 * 24))
        w += ageDays * qty
        q += qty
      }
      if (q > 0) {
        metrics.avgFeedAgeDays = Math.round((w / q) * 10) / 10
      }
    }

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
      const row = metrics.stockLevels.find((s) => s.name === feedType)
      if (row && avgDailyUsage > 0) {
        metrics.daysRemaining[feedType] = Math.floor(
          (Number(row.currentStock) || 0) / avgDailyUsage,
        )
      }
    })

    metrics.reorderRecommendations = metrics.stockLevels
      .filter((row) => {
        const min = Number(row.minimumStock) || 0
        if (min <= 0) return false
        return (Number(row.currentStock) || 0) <= min * 1.2
      })
      .map((row) => {
        const current = Number(row.currentStock) || 0
        const minimum = Number(row.minimumStock) || 0
        const bagSize = Number(row.bagSizeKg) || 20
        const recommendedOrder = Math.max(0, Math.ceil(minimum * 2 - current))
        return {
          id: row.feedTypeId || row.id,
          name: row.name,
          location: row.location,
          currentStock: current,
          minimumStock: minimum,
          bagSizeKg: bagSize,
          protein: row.protein,
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

    return analytics
  }

  const calculateSupplierMetrics = (purchases, suppliers) => {
    const metrics = {
      reliability: [],
      priceComparison: [],
      unassigned: null,
      deliveryPerformance: {},
      qualityMetrics: {}
    }

    const supplierOrders = {}
    let unassigned = {
      totalOrders: 0,
      totalCost: 0,
      totalQuantity: 0,
    }

    purchases.forEach((purchase) => {
      const supplierName =
        purchase.suppliers?.name || purchase.supplier?.name || null
      const cost =
        (Number(purchase.quantity) || 0) * (Number(purchase.price_per_kg) || 0)
      const qty = Number(purchase.quantity) || 0

      if (!supplierName) {
        unassigned.totalOrders++
        unassigned.totalCost += cost
        unassigned.totalQuantity += qty
        return
      }

      if (!supplierOrders[supplierName]) {
        supplierOrders[supplierName] = {
          totalOrders: 0,
          onTimeDeliveries: 0,
          totalCost: 0,
          totalQuantity: 0,
        }
      }
      supplierOrders[supplierName].totalOrders++
      supplierOrders[supplierName].totalCost += cost
      supplierOrders[supplierName].totalQuantity += qty
      // No real delivery ETA yet — treat recorded purchases as completed on time
      supplierOrders[supplierName].onTimeDeliveries++
    })

    metrics.reliability = Object.entries(supplierOrders)
      .map(([supplier, data]) => ({
        supplier,
        reliability: (data.onTimeDeliveries / data.totalOrders) * 100,
        totalOrders: data.totalOrders,
        totalCost: data.totalCost,
        averagePrice:
          data.totalQuantity > 0 ? data.totalCost / data.totalQuantity : 0,
        unassigned: false,
      }))
      .sort((a, b) => b.totalOrders - a.totalOrders)

    if (unassigned.totalOrders > 0) {
      metrics.unassigned = {
        supplier: 'No supplier',
        totalOrders: unassigned.totalOrders,
        totalCost: unassigned.totalCost,
        averagePrice:
          unassigned.totalQuantity > 0
            ? unassigned.totalCost / unassigned.totalQuantity
            : 0,
        unassigned: true,
      }
    }

    metrics.priceComparison = metrics.reliability.map((item) => ({
      supplier: item.supplier,
      averagePrice: item.averagePrice,
      totalOrders: item.totalOrders,
    }))

    return metrics
  }

  const bagSizeKg = resolveBagSizeKg(formData.bag_size_kg)

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => {
      const next = { ...prev, [name]: value }
      let size = resolveBagSizeKg(prev.bag_size_kg)

      if (name === 'feed_type_id') {
        const ft = feedTypes.find((t) => (t.id || t._id) === value)
        // Keep bag size at default / user choice
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
        size = resolveBagSizeKg(value)
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
    setPurchaseDefaultFeedTypeId('')
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
    setPurchaseDefaultFeedTypeId(
      ft ? String(ft.id || ft._id) : '',
    )
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
      if (!formData.supplier_id) {
        throw new Error('Supplier is required')
      }
      await updatePurchase(purchaseUpdateArgs(editingPurchase.id, {
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
      }))

      showToast('success', 'Purchase updated successfully')
      setSuccess('Purchase updated successfully')
      setTimeout(() => {
        setShowEditModal(false)
      }, 1500)
    } catch (error) {
      setError(errorMessage(error))
    }
  }

  const handleDeletePurchase = async () => {
    const id = deleteConfirm?.id || deleteConfirm?._id
    if (!id) return
    try {
      await voidPurchase({ id })

      showToast('success', 'Purchase deleted successfully')
      setDeleteConfirm(null)
    } catch (error) {
      showToast('error', errorMessage(error, 'Failed to delete purchase'))
    }
  }

  const COLORS = ['var(--lake)', 'var(--kelp)', '#d97706', 'var(--signal)', 'var(--muted)', 'var(--kelp-soft)']

  return (
    <Layout
      title={t('ops.purchases.title')}
      eyebrow={t('ops.purchases.eyebrow', { site: activeLocation?.name || '—' })}
      actions={
        canRecord ? (
          <GradientButton icon={Plus} onClick={handleAddPurchase} data-tour="feed-purchases-record">
            {t('ops.purchases.record')}
          </GradientButton>
        ) : null
      }
    >
      <div data-tour="page-feed-purchases" className="flex flex-col gap-[28px]">
        <NavTabs tabs={feedTabs(t)} label={t('ops.tabs.feed')} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] leading-5 text-muted">{t('ops.purchases.window')}</p>
          <Segmented
            label={t('ops.common.timeRange')}
            options={['7d', '30d', '90d', '1y'].map((range) => ({ value: range, label: range }))}
            value={timeRange}
            onChange={setTimeRange}
          />
        </div>

        <div data-tour="feed-purchases-kpis">
          <KpiStrip
            items={[
              { label: t('ops.purchases.totalCost'), value: formatCurrency(stats.totalCost) },
              { label: t('ops.purchases.bought'), value: formatWeight(stats.totalQuantity) },
              { label: t('ops.purchases.avgPerKg'), value: formatCurrency(stats.averageCostPerKg) },
              { label: t('ops.purchases.stockValue'), value: formatCurrency(stats.stockValue) },
              { label: t('ops.purchases.bagsOnHand'), value: formatNumber(stats.totalBags || 0, { decimals: 0 }) },
              {
                label: t('ops.purchases.feedAge'),
                value: stats.avgFeedAgeDays != null ? formatNumber(stats.avgFeedAgeDays, { decimals: 0 }) : '—',
                suffix: stats.avgFeedAgeDays != null ? t('ops.purchases.daysUnit') : undefined,
              },
            ]}
          />
        </div>

        <Panel
          title={t('ops.feed.lowStock')}
          meta={lowStockAlerts.length ? t('ops.feed.items', { count: lowStockAlerts.length }) : undefined}
          action={lowStockAlerts.length ? undefined : { label: t('ops.purchases.openFeedTypes'), href: '/feed-types' }}
        >
          {lowStockAlerts.length === 0 ? (
            <p className="py-3 text-[13px] leading-5 text-muted">{t('ops.purchases.noLowStock')}</p>
          ) : (
            lowStockAlerts.map((feed) => (
              <ListRow
                key={feed.id || feed.name}
                dot="alert"
                dotLabel={t('ops.feed.lowStockShort')}
                title={feed.name}
                sub={`${formatWeight(feed.current_stock)} · ${t('ops.feed.minKg', { amount: formatWeight(feed.minimum_stock) })}`}
              >
                {canRecord && (
                  <GhostButton size="sm" onClick={() => handleOrderFeed(feed.id || feed.name)}>
                    {t('ops.purchases.order')}
                  </GhostButton>
                )}
              </ListRow>
            ))
          )}
        </Panel>

        {/* Cost Analysis Section */}
        <div className="page-card mb-6 p-5">
          <h2 className="mb-4 text-[15px] leading-6 font-semibold text-chart-ink">Cost analysis</h2>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Cost Trends Chart */}
            <div className="rounded-xl border border-foam-deep bg-surface p-4">
              <h3 className="mb-3 text-xs font-semibold text-muted">Cost trends</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsLineChart data={costAnalysis.costTrends}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--foam-deep)" />
                    <XAxis dataKey="month" tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                    <YAxis tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="cost" stroke="var(--lake)" strokeWidth={2} />
                  </RechartsLineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Supplier Comparison Chart */}
            <div className="rounded-xl border border-foam-deep bg-surface p-4">
              <h3 className="mb-3 text-xs font-semibold text-muted">Supplier price</h3>
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
        <div
          className="page-card mb-6 overflow-hidden"
          data-tour="feed-purchases-inventory"
        >
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-foam-deep px-5 py-4">
            <div>
              <h2 className="text-[15px] leading-6 font-semibold text-chart-ink">
                Inventory
              </h2>
              <p className="mt-0.5 text-xs text-muted">
                {activeLocation?.name || 'This location'} · bag size · protein ·
                reorder only when a minimum is set
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-muted">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-kelp" /> OK
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-warn" /> Near min
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
              <h3 className="mb-3 text-xs font-semibold text-muted">
                Current stock
              </h3>
              {inventoryMetrics.stockLevels.length === 0 ? (
                <p className="py-8 text-center text-[13px] leading-5 text-muted">
                  No feed types yet.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {inventoryMetrics.stockLevels.map((stock) => {
                    const barTone =
                      stock.status === 'critical'
                        ? 'bg-signal'
                        : stock.status === 'low'
                          ? 'bg-warn'
                          : stock.status === 'empty'
                            ? 'bg-muted/40'
                            : 'bg-kelp'
                    return (
                      <li
                        key={stock.id || `${stock.name}-${stock.location}`}
                        className="rounded-xl border border-foam-deep/70 bg-surface px-3 py-2.5 transition-colors duration-200 hover:border-foam-deep"
                      >
                        <div className="mb-1.5 flex items-baseline justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="text-[13px] leading-5 font-medium text-chart-ink">
                                {stock.name}
                              </span>
                              {stock.location ? (
                                <span className="inline-flex items-center rounded-lg border border-foam-deep/80 bg-foam-deep/30 px-1.5 py-0.5 text-xs font-medium text-muted">
                                  {stock.location}
                                </span>
                              ) : null}
                            </div>
                            <span className="text-xs text-muted">
                              {stock.protein != null ? `${stock.protein}% protein` : 'Protein —'}
                              {' · '}
                              {stock.bagSizeKg}Kg bags
                              {stock.bagsOnHand != null
                                ? ` · ~${stock.bagsOnHand} bags`
                                : ''}
                            </span>
                          </div>
                          <span className="shrink-0 font-data text-[13px] leading-5 font-semibold text-chart-ink tabular-nums">
                            {formatWeight(stock.currentStock)}
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-foam-deep">
                          <div
                            className={`h-full rounded-full transition-[width] duration-300 ${barTone}`}
                            style={{ width: `${Math.max(stock.barPct, stock.currentStock > 0 ? 4 : 0)}%` }}
                          />
                        </div>
                        <div className="mt-1 flex justify-between gap-3 text-xs text-muted tabular-nums">
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
            <div className="bg-foam p-4 lg:col-span-2">
              <h3 className="mb-3 text-xs font-semibold text-muted">
                Reorder
              </h3>
              {inventoryMetrics.reorderRecommendations.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-foam-deep px-4 py-10 text-center">
                  <Package className="mb-2 h-8 w-8 text-muted/60" aria-hidden />
                  <p className="text-[13px] leading-5 font-medium text-chart-ink">
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
                      className="rounded-lg border border-warn/30 bg-surface p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[13px] leading-5 font-semibold text-chart-ink">
                            {rec.name}
                          </p>
                          <p className="mt-0.5 text-xs text-muted tabular-nums">
                            {formatWeight(rec.currentStock)} on hand · min{' '}
                            {formatWeight(rec.minimumStock)}
                            {rec.protein != null ? ` · ${rec.protein}%` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <p className="font-data text-xs text-muted tabular-nums">
                          Suggest {formatWeight(rec.recommendedOrder)}
                          {rec.recommendedBags != null
                            ? ` (~${rec.recommendedBags}×${rec.bagSizeKg}kg)`
                            : ''}
                        </p>
                        <Button
                          size="sm"
                          onClick={() => handleOrderFeed(rec.id || rec.name)}
                          className="shrink-0"
                        >
                          Order
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Usage Analytics Section */}
        <div className="page-card p-4 sm:p-6 mb-6">
          <h2 className="text-lg font-medium text-chart-ink mb-4">Usage analytics</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Cage Usage Chart */}
            <div className="bg-surface rounded-lg p-4">
              <h3 className="text-[13px] leading-5 font-medium text-chart-ink mb-4">Feed usage by cage</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RechartsBarChart data={usageAnalytics.cageUsage}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--foam-deep)" />
                    <XAxis dataKey="cageName" tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                    <YAxis tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="totalUsage" fill="var(--lake)" />
                  </RechartsBarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* eFCR by cage: real figures from the growth calculation */}
            <div className="bg-surface rounded-lg p-4">
              <div className="flex items-baseline justify-between gap-2 mb-4">
                <h3 className="text-[13px] leading-5 font-medium text-chart-ink">eFCR by cage, current cycle</h3>
                {usageAnalytics.farmEfcr != null && (
                  <span className="text-[13px] leading-5 text-muted tabular-nums">
                    Farm {usageAnalytics.farmEfcr.toFixed(2)}
                  </span>
                )}
              </div>
              {(usageAnalytics.fcrByCage || []).length === 0 ? (
                <p className="h-64 flex items-center justify-center text-center text-[13px] leading-5 text-muted px-6">
                  eFCR appears once a cage has a stocking, logged feed and a bi-weekly sample.
                </p>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsBarChart data={usageAnalytics.fcrByCage} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid horizontal={false} stroke="var(--foam-deep)" />
                      <XAxis type="number" tick={{ fontSize: 12, fill: 'var(--muted)' }} />
                      <YAxis type="category" dataKey="cage" width={64} tick={{ fontSize: 12, fill: 'var(--muted)' }} />
                      <Tooltip formatter={(v) => Number(v).toFixed(2)} />
                      <Bar dataKey="efcr" name="eFCR" fill="var(--lake)" radius={[0, 4, 4, 0]} />
                    </RechartsBarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Supplier Performance Section */}
        <div className="page-card mb-6 overflow-hidden">
          <div className="border-b border-foam-deep px-5 py-4">
            <h2 className="text-[15px] leading-6 font-semibold text-chart-ink">
              Supplier performance
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              Based on recorded purchases. Supplier is required on every purchase.
            </p>
          </div>
          <div className="grid grid-cols-1 gap-0 lg:grid-cols-2 lg:divide-x lg:divide-foam-deep">
            {/* Supplier Reliability */}
            <div className="p-5">
              <h3 className="mb-3 text-xs font-semibold text-muted">
                Order volume
              </h3>
              <div className="space-y-3">
                {supplierMetrics.reliability && supplierMetrics.reliability.length > 0 ? (
                  supplierMetrics.reliability.map((metric, index) => (
                    <div
                      key={metric.supplier || index}
                      className="flex items-center justify-between gap-3 rounded-lg border border-foam-deep bg-surface px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="text-[13px] leading-5 font-medium text-chart-ink">
                          {metric.supplier}
                        </span>
                        <p className="text-xs text-muted tabular-nums">
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
                        <span className="w-12 text-right font-data text-xs text-muted tabular-nums">
                          {metric.reliability.toFixed(0)}%
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="py-6 text-center text-[13px] leading-5 text-muted">
                    No supplier data yet — record purchases with a supplier selected.
                  </p>
                )}
                {supplierMetrics.unassigned ? (
                  <div className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] leading-5 font-medium text-chart-ink">
                          Unassigned supplier
                        </p>
                        <p className="text-xs text-muted">
                          {supplierMetrics.unassigned.totalOrders}{' '}
                          {supplierMetrics.unassigned.totalOrders === 1
                            ? 'order'
                            : 'orders'}
                          {' · '}
                          {formatCurrency(supplierMetrics.unassigned.totalCost || 0)}
                        </p>
                        <p className="mt-1 text-xs text-muted">
                          Edit those purchases and assign a supplier — required for all new purchases.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Price Comparison */}
            <div className="p-5">
              <h3 className="mb-3 text-xs font-semibold text-muted">
                Price comparison
              </h3>
              <div className="h-64">
                {supplierMetrics.priceComparison && supplierMetrics.priceComparison.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <RechartsBarChart data={supplierMetrics.priceComparison}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--foam-deep)" />
                      <XAxis dataKey="supplier" tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                      <YAxis tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="averagePrice" fill="var(--lake)" />
                    </RechartsBarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-[13px] leading-5 text-muted">
                    No price comparison data available
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Purchases Table */}
        <div className="page-card overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-foam-deep">
            <h2 className="font-medium text-chart-ink">Recent purchases</h2>
          </div>

          {loading ? (
            <LoadingState label="Loading purchases..." />
          ) : purchases.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-foam-deep">
                <thead className="bg-foam-deep/40">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted">
                      Feed type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted">
                      Quantity
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted">
                      Bags
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted">
                      Price/kg
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted">
                      Total cost
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted">
                      Purchase date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted">
                      Supplier
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted">
                      Batch number
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-muted">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-surface divide-y divide-foam-deep">
                  {purchases.map((purchase) => (
                    <tr key={purchase.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-[13px] leading-5 font-medium text-chart-ink">
                        {purchase.feed_types?.name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-[13px] leading-5 text-muted font-data tabular-nums">
                        {purchase.quantity} kg
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-[13px] leading-5 text-muted font-data tabular-nums">
                        {purchase.bags != null
                          ? `${purchase.bags} bags`
                          : '—'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-[13px] leading-5 text-muted tabular-nums">
                        {formatCurrency(purchase.price_per_kg)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-[13px] leading-5 text-muted tabular-nums">
                        {formatCurrency(purchase.quantity * purchase.price_per_kg)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-[13px] leading-5 text-muted tabular-nums">
                        {new Date(purchase.purchase_date).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-[13px] leading-5 text-muted">
                        {purchase.suppliers?.name ||
                          purchase.supplier?.name ||
                          '—'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-[13px] leading-5 text-muted">
                        {purchase.batch_number || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-[13px] leading-5 text-muted">
                        {isAdmin ? (
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleEditPurchase(purchase)}
                              className="text-lake"
                              title="Edit purchase"
                              aria-label="Edit purchase"
                            >
                              <Edit className="w-4 h-4" aria-hidden />
                            </Button>

                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setDeleteConfirm(purchase)}
                              className="text-signal"
                              title="Delete purchase"
                              aria-label="Delete purchase"
                            >
                              <Trash className="w-4 h-4" aria-hidden />
                            </Button>
                          </div>
                        ) : (
                          '—'
                        )}
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

      <FeedPurchaseModal
        open={showAddModal}
        onClose={() => {
          setShowAddModal(false)
          setPurchaseDefaultFeedTypeId('')
        }}
        feedTypes={feedTypes}
        suppliers={suppliers}
        defaultFeedTypeId={purchaseDefaultFeedTypeId}
        title="New feed purchase"
      />

      {/* Edit Purchase Modal */}
      {showEditModal && editingPurchase && (
        <Modal
          onClose={() => setShowEditModal(false)}
          as="form"
          onSubmit={handleSubmitEdit}
          title="Edit purchase"
          bodyClassName="space-y-4"
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => setShowEditModal(false)}
              >
                Cancel
              </Button>
              <Button type="submit">
                Save changes
              </Button>
            </>
          }
        >
          {error && (
            <div className="rounded-lg border border-signal/20 bg-signal/10 text-signal p-3 text-[13px] leading-5">
              {error}
            </div>
          )}

          {success && (
            <div className="rounded-lg border border-kelp/20 bg-kelp/10 text-kelp p-3 text-[13px] leading-5">
              {success}
            </div>
          )}

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
            onCreated={(result) => {
              if (result?.id) {
                setFormData((prev) => ({
                  ...prev,
                  feed_type_id: result.id,
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
            <Field label="Bags" htmlFor="fp-edit-bags">
              <Input
                id="fp-edit-bags"
                type="number"
                name="bags"
                value={formData.bags}
                onChange={handleChange}
                step="0.01"
                min="0"
                className="font-data tabular-nums"
                placeholder="e.g. 40"
              />
            </Field>
            <Field label="Quantity (kg)" htmlFor="fp-edit-quantity" required>
              <Input
                id="fp-edit-quantity"
                type="number"
                name="quantity"
                value={formData.quantity}
                onChange={handleChange}
                step="0.01"
                min="0"
                className="font-data tabular-nums"
                required
              />
              <p className="mt-1 text-xs text-muted">
                At {bagSizeKg} kg/bag — enter bags or kg; the other updates.
              </p>
            </Field>
          </div>

          <Field label="Price per kg (₵)" htmlFor="fp-edit-price-per-kg" required>
            <Input
              id="fp-edit-price-per-kg"
              type="number"
              name="price_per_kg"
              value={formData.price_per_kg}
              onChange={handleChange}
              step="0.01"
              min="0"
              required
            />
          </Field>

          <Field label="Purchase date" htmlFor="fp-edit-purchase-date" required>
            <Input
              id="fp-edit-purchase-date"
              type="date"
              name="purchase_date"
              value={formData.purchase_date}
              onChange={handleChange}
              required
            />
          </Field>

          <Field label="Supplier" htmlFor="fp-edit-supplier-id" required>
            <Select
              id="fp-edit-supplier-id"
              name="supplier_id"
              value={formData.supplier_id || ''}
              onChange={handleChange}
              required
            >
              <option value="">Select supplier</option>
              {suppliers.map((supplier) => (
                <option
                  key={supplier.id || supplier._id}
                  value={supplier.id || supplier._id}
                >
                  {supplier.name}
                </option>
              ))}
            </Select>
            {suppliers.length === 0 && (
              <p className="mt-1 text-xs text-muted">
                No suppliers yet — add one under Feed suppliers.
              </p>
            )}
          </Field>

          <Field label="Batch number" htmlFor="fp-edit-batch-number">
            <Input
              id="fp-edit-batch-number"
              type="text"
              name="batch_number"
              value={formData.batch_number}
              onChange={handleChange}
            />
          </Field>

          <Field label="Expiry date" htmlFor="fp-edit-expiry-date">
            <Input
              id="fp-edit-expiry-date"
              type="date"
              name="expiry_date"
              value={formData.expiry_date}
              onChange={handleChange}
            />
          </Field>

          <Field label="Notes" htmlFor="fp-edit-notes">
            <Textarea
              id="fp-edit-notes"
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows={3}
            />
          </Field>
        </Modal>
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