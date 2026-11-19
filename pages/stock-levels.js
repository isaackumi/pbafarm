import { useQuery } from 'convex/react'
import { Package } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { PageHeader, Button, LoadingState } from '../components/ui'
import { api } from '../convex/_generated/api'
import { useMoney } from '../lib/money'
import { useLocation } from '../contexts/LocationContext'

export default function StockLevelsPage() {
  return (
    <ProtectedRoute>
      <StockLevels />
    </ProtectedRoute>
  )
}

function StockLevels() {
  const money = useMoney()
  // Stock at the header site (FARM-003); the tally check stays company-wide.
  const { locationArgs } = useLocation()
  const stockResult = useQuery(api.inventory.listStockLevels, locationArgs)
  const tally = useQuery(api.inventory.stockTally, {})
  const loading = stockResult === undefined || tally === undefined
  const stockLevels = stockResult || []

  const getStockStatus = (current, minimum) => {
    if (current <= minimum * 0.5) return 'critical'
    if (current <= minimum * 1.2) return 'low'
    return 'good'
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'critical':
        return 'text-signal bg-signal/10'
      case 'low':
        return 'text-warn bg-warn/10'
      case 'good':
        return 'text-kelp bg-kelp/10'
      default:
        return 'text-muted bg-foam-deep/40'
    }
  }

  const tallyById = Object.fromEntries(
    (tally || []).map((r) => [r.feed_type_id, r]),
  )

  return (
    <Layout title="Stock Levels">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Inventory', href: '/inventory/overview' },
          { label: 'Stock levels' },
        ]}
        description="On-hand feed stock from the inventory ledger. Tally should match."
        related={[
          { label: 'Issue feed', href: '/feed-issue' },
          { label: 'Feed purchases', href: '/feed-purchases' },
          { label: 'Inventory alerts', href: '/inventory-alerts' },
          { label: 'Ledger', href: '/inventory-transactions' },
        ]}
        actions={
          <>
            <Button href="/feed-issue" variant="secondary" size="sm">
              Issue feed
            </Button>
          </>
        }
      />


        <div className="page-card overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-foam-deep">
            <h2 className="font-medium text-chart-ink">
              On-hand stock (kg + bags)
            </h2>
            <p className="text-xs text-muted mt-1">
              Stock changes only through the inventory ledger. Tally column must
              match.
            </p>
          </div>

          {loading ? (
            <LoadingState />
          ) : stockLevels.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-foam-deep">
                <thead className="bg-foam-deep/40">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted">
                      Feed type
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted">
                      Supplier
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted">
                      kg
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted">
                      Bags
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted">
                      Bag size
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted">
                      Min kg
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted">
                      Ledger tally
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted">
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-surface divide-y divide-foam-deep">
                  {stockLevels.map((item) => {
                    const status = getStockStatus(
                      item.current_stock,
                      item.minimum_stock,
                    )
                    const t = tallyById[item.feed_type_id]
                    return (
                      <tr key={item.feed_type_id}>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center">
                            <Package className="h-5 w-5 text-muted mr-2" />
                            <span className="text-sm font-medium text-chart-ink">
                              {item.feed_type_name}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted">
                          {item.supplier_name || '—'}
                        </td>
                        <td className="px-4 py-3 text-sm text-right tabular-nums">
                          {Number(item.current_stock).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right tabular-nums">
                          {Number(item.current_stock_bags || 0).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right tabular-nums">
                          {Number(item.bag_size_kg || 25).toFixed(0)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right tabular-nums">
                          {Number(item.minimum_stock).toFixed(2)}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(
                              status,
                            )}`}
                          >
                            {status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm tabular-nums">
                          {t ? (
                            <span
                              className={
                                t.ok ? 'text-kelp' : 'text-signal font-semibold'
                              }
                            >
                              {t.ok ? 'OK' : `Δ ${t.delta}`}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-right tabular-nums">
                          {money(item.stock_value || 0)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center">
              <Package className="h-12 w-12 text-muted mx-auto" />
              <p className="mt-3 text-muted">No stock levels found.</p>
            </div>
          )}
        </div>
    </Layout>
  )
}
