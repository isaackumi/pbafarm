import { useMemo, useState } from 'react'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { PageHeader, StatCard, Select, LoadingState } from '../../components/ui'
import { useMoney } from '../../lib/money'
import { api } from '../../convex/_generated/api'
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
  const [timeRange, setTimeRange] = useState('30d')
  // Window fixed per range choice so the live query args stay stable.
  const range = useMemo(() => {
    const start = new Date()
    if (timeRange === '7d') start.setDate(start.getDate() - 7)
    else if (timeRange === '90d') start.setDate(start.getDate() - 90)
    else if (timeRange === '1y') start.setFullYear(start.getFullYear() - 1)
    else start.setDate(start.getDate() - 30)
    return { dateFrom: start.getTime(), dateTo: Date.now() }
  }, [timeRange])
  const itemsResult = useQuery(api.inventory.listStockLevels, {})
  const transactionsResult = useQuery(api.inventory.listTransactions, {
    ...range,
    limit: 500,
  })
  const loading = itemsResult === undefined || transactionsResult === undefined
  const inventoryItems = itemsResult || []

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

  const transactionData = processTransactionData(transactionsResult)
  const categoryData = processCategoryData(itemsResult)
  const trendData = processTrendData(transactionsResult)

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
          </div>
        }
      />

        {loading ? (
          <LoadingState label="Loading analytics..." />
        ) : (
        <>

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
        </>
        )}
    </Layout>
  )
} 