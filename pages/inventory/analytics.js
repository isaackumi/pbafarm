import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import {
  RefreshCw,
} from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { PageHeader, StatCard, Button, Select } from '../../components/ui'
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
  const money = useMoney()
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
    setError(null)
    try {
      const endMs = Date.now()
      const start = new Date()
      switch (timeRange) {
        case '7d':
          start.setDate(start.getDate() - 7)
          break
        case '30d':
          start.setDate(start.getDate() - 30)
          break
        case '90d':
          start.setDate(start.getDate() - 90)
          break
        case '1y':
          start.setFullYear(start.getFullYear() - 1)
          break
        default:
          start.setDate(start.getDate() - 30)
      }
      const dateFrom = start.getTime()
      const dateTo = endMs

      const client = getConvexHttpClient()

      const itemsData = await client.query(api.inventory.listStockLevels, {})
      setInventoryItems(itemsData || [])

      const transactionsData = await client.query(api.inventory.listTransactions, {
        dateFrom,
        dateTo,
        limit: 500,
      })

      const processedTransactionData = processTransactionData(transactionsData)
      setTransactionData(processedTransactionData)

      const processedCategoryData = processCategoryData(itemsData)
      setCategoryData(processedCategoryData)

      const processedTrendData = processTrendData(transactionsData)
      setTrendData(processedTrendData)
    } catch (error) {
      console.error('Error fetching data:', error)
      showToast('error', error.message || 'Failed to load analytics data')
      setError(error.message || 'Failed to load data. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const IN_TYPES = new Set(['purchase', 'adjustment', 'transfer', 'reversal'])
  const OUT_TYPES = new Set(['usage', 'issue', 'daily_usage'])

  const qtyKg = (item) => Number(item.quantity_kg ?? item.quantity ?? 0)

  const processTransactionData = (data) => {
    // Transfer legs (INV-002) move stock between sites; company-wide they net to zero.
    const moves = (data || []).filter(
      (t) => t.transaction_type !== 'transfer_out' && t.transaction_type !== 'transfer_in',
    )
    const grouped = moves.reduce((acc, item) => {
      const date = new Date(item.transaction_date).toLocaleDateString()
      if (!acc[date]) acc[date] = { in: 0, out: 0 }
      const type = item.transaction_type
      const qty = Math.abs(qtyKg(item))
      if (OUT_TYPES.has(type) || qtyKg(item) < 0) {
        acc[date].out += qty
      } else if (IN_TYPES.has(type) || type === 'purchase') {
        acc[date].in += qty
      } else {
        acc[date].in += qty
      }
      return acc
    }, {})

    return Object.entries(grouped).map(([date, values]) => ({
      date,
      ...values,
    }))
  }

  const processCategoryData = (data) => {
    const rows = (data || []).map((item) => ({
      name: item.feed_type_name || 'Feed',
      value: Number(item.stock_value ?? 0),
    }))
    const withValue = rows.filter((r) => r.value > 0)
    return withValue.length ? withValue : [{ name: 'No stock value', value: 0 }]
  }

  const processTrendData = (data) => {
    const grouped = (data || []).reduce((acc, item) => {
      const date = new Date(item.transaction_date).toLocaleDateString()
      if (!acc[date]) acc[date] = 0
      const type = item.transaction_type
      const qty = qtyKg(item)
      if (OUT_TYPES.has(type)) {
        acc[date] -= Math.abs(qty)
      } else if (type === 'purchase') {
        acc[date] += Math.abs(qty)
      } else {
        acc[date] += qty
      }
      return acc
    }, {})

    return Object.entries(grouped).map(([date, value]) => ({
      date,
      value,
    }))
  }

  const COLORS = ['var(--lake)', 'var(--kelp)', '#d97706', 'var(--signal)', 'var(--muted)']

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
            <Select
              aria-label="Time range"
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value)}
              className="w-auto"
            >
              <option value="7d">Last 7 days</option>
              <option value="30d">Last 30 days</option>
              <option value="90d">Last 90 days</option>
              <option value="1y">Last year</option>
            </Select>

            <Button variant="secondary" onClick={fetchData}>
              <RefreshCw className="w-4 h-4" aria-hidden />
              Refresh
            </Button>
          </div>
        }
      />

        {error && (
          <div className="mb-4 rounded-lg border border-signal/20 bg-signal/10 text-signal p-3 text-sm">
            {error}
          </div>
        )}

        {/* Transaction Analysis */}
        <div className="page-card p-4 sm:p-6 mb-6">
          <h3 className="text-lg font-medium text-chart-ink mb-4">Transaction analysis</h3>
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
                  stroke="var(--lake)"
                  fill="var(--lake)"
                />
                <Area
                  type="monotone"
                  dataKey="out"
                  stackId="1"
                  stroke="var(--kelp)"
                  fill="var(--kelp)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Category Analysis */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="page-card p-4 sm:p-6">
            <h3 className="text-lg font-medium text-chart-ink mb-4">Category distribution</h3>
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

          <div className="page-card p-4 sm:p-6">
            <h3 className="text-lg font-medium text-chart-ink mb-4">Stock trend</h3>
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
                    stroke="var(--lake)"
                    strokeWidth={2}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Key Performance Indicators */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard label="Feed types" value={inventoryItems.length} />
          <StatCard
            label="Stock value"
            value={money(
              inventoryItems.reduce((sum, item) => sum + Number(item.stock_value || 0), 0),
              { decimals: 0 },
            )}
          />
          <StatCard
            label="Low stock"
            value={inventoryItems.filter((i) => i.is_low_stock).length}
            tone={inventoryItems.some((i) => i.is_low_stock) ? 'warn' : 'default'}
          />
          <StatCard
            label="On hand"
            value={inventoryItems
              .reduce((sum, item) => sum + Number(item.current_stock || 0), 0)
              .toLocaleString(undefined, { maximumFractionDigits: 0 })}
            unit="kg"
          />
        </div>

    </Layout>
  )
} 