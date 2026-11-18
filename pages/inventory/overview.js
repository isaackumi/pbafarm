import { useMemo } from 'react'
import { useQuery } from 'convex/react'
import {
  Package,
  BarChart2,
  ShoppingCart,
} from 'lucide-react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { PageHeader, StatCard, Button } from '../../components/ui'
import { useMoney } from '../../lib/money'
import { useAuth } from '../../contexts/AuthContext'
import { useLocation } from '../../contexts/LocationContext'
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
// The two legs of a site-to-site transfer (INV-002) cancel out company-wide.
const isTransferLeg = (t) => t.transaction_type === 'transfer_out' || t.transaction_type === 'transfer_in'

function processTransactionData(data) {
  const grouped = data.filter((t) => !isTransferLeg(t)).reduce((acc, item) => {
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
  const money = useMoney()
  const kg = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })
  const dateFrom = useMemo(() => Date.now() - 30 * 24 * 60 * 60 * 1000, [])

  // The header site (FARM-003): stock and movements at that site.
  const { locationArgs } = useLocation()
  const inventoryItems = useQuery(
    api.inventory.listStockLevels,
    user ? locationArgs : 'skip',
  )
  const transactions = useQuery(
    api.inventory.listTransactions,
    user ? { dateFrom, limit: 200, ...locationArgs } : 'skip',
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
      // Days of cover: stock on hand ÷ average daily use over the last 30 days.
      daysOfCover: (() => {
        const usedKg = txns
          .filter((t) => Number(t.quantity_kg) < 0 && t.transaction_type !== 'reversal' && !isTransferLeg(t))
          .reduce((sum, t) => sum - Number(t.quantity_kg), 0)
        const perDay = usedKg / 30
        return perDay > 0 ? Math.round(totalItems / perDay) : null
      })(),
      usedKg30: txns
        .filter((t) => Number(t.quantity_kg) < 0 && t.transaction_type !== 'reversal' && !isTransferLeg(t))
        .reduce((sum, t) => sum - Number(t.quantity_kg), 0),
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
  const COLORS = ['var(--lake)', 'var(--kelp)', '#d97706', 'var(--signal)', 'var(--muted)']

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
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-lake mx-auto" />
          <p className="mt-3 text-muted">Loading inventory…</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Button href="/stock-levels" variant="secondary" className="w-full">
              <Package className="w-4 h-4" aria-hidden />
              Stock levels
            </Button>
            <Button href="/feed-types" variant="secondary" className="w-full">
              <Package className="w-4 h-4" aria-hidden />
              Feed types
            </Button>
            <Button href="/inventory/adjust" variant="secondary" className="w-full">
              <ShoppingCart className="w-4 h-4" aria-hidden />
              Adjust / transfer
            </Button>
            <Button href="/inventory/analytics" variant="secondary" className="w-full">
              <BarChart2 className="w-4 h-4" aria-hidden />
              Analytics
            </Button>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <StatCard label="Feed on hand" value={kg(metrics.totalItems)} unit="kg" />
            <StatCard label="Stock value" value={money(metrics.totalValue, { decimals: 0 })} />
            <StatCard
              label="Low stock"
              value={metrics.lowStockItems}
              unit={metrics.lowStockItems === 1 ? 'feed type' : 'feed types'}
              tone={metrics.lowStockItems > 0 ? 'warn' : 'default'}
            />
            <StatCard label="Used, last 30 days" value={kg(metrics.usedKg30)} unit="kg" />
            <StatCard
              label="Days of cover"
              value={metrics.daysOfCover == null ? '—' : metrics.daysOfCover}
              unit={metrics.daysOfCover == null ? '' : 'days'}
              hint="At the last 30 days' rate of use"
              tone={metrics.daysOfCover != null && metrics.daysOfCover < 14 ? 'warn' : 'accent'}
            />
            <StatCard label="Ledger entries, 30 days" value={metrics.monthlyTransactions} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <div className="page-card p-4 sm:p-6">
              <h3 className="text-lg font-medium text-chart-ink mb-4">
                Transaction trend
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

            <div className="page-card p-4 sm:p-6">
              <h3 className="text-lg font-medium text-chart-ink mb-4">
                Category distribution
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

            <div className="page-card p-4 sm:p-6">
              <h3 className="text-lg font-medium text-chart-ink mb-4">
                Low stock alerts
              </h3>
              <div className="space-y-4">
                {lowStock.length === 0 ? (
                  <p className="text-sm text-muted">No low-stock items.</p>
                ) : (
                  lowStock.map((item) => (
                    <div
                      key={item.feed_type_id}
                      className="flex items-center justify-between gap-4 p-4 rounded-xl border border-signal/25 bg-signal/10"
                    >
                      <div>
                        <p className="font-medium text-chart-ink">
                          {item.feed_type_name}
                        </p>
                        <p className="text-sm text-muted tabular-nums">
                          Current: {item.current_stock} kg
                          {item.current_stock_bags != null
                            ? ` (${Number(item.current_stock_bags).toFixed(1)} bags)`
                            : ''}{' '}
                          | Minimum: {item.minimum_stock} kg
                        </p>
                      </div>
                      <Button
                        href="/inventory-transactions"
                        variant="ghost"
                        size="sm"
                        className="text-signal shrink-0"
                      >
                        Order now
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="page-card overflow-hidden">
            <div className="px-4 sm:px-6 py-4 border-b border-foam-deep">
              <h3 className="text-lg font-medium text-chart-ink">Feed types</h3>
            </div>
            <div className="divide-y divide-foam-deep">
              {(inventoryItems || []).slice(0, 5).map((item) => (
                <div key={item.feed_type_id} className="px-4 sm:px-6 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-chart-ink">
                        {item.feed_type_name}
                      </p>
                      <p className="text-sm text-muted tabular-nums">
                        Stock: {item.current_stock} kg
                        {item.current_stock_bags != null
                          ? ` (${Number(item.current_stock_bags).toFixed(1)} bags)`
                          : ''}{' '}
                        | Price: {money(item.price_per_kg)}/kg
                      </p>
                    </div>
                    <div className="text-sm text-muted tabular-nums shrink-0">
                      Value: {money(item.stock_value || 0)}
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
