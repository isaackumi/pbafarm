import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Package, RefreshCw } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import { useToast } from '../components/Toast'
import { getConvexHttpClient, api } from '../lib/convexBridge'

export default function StockLevelsPage() {
  return (
    <ProtectedRoute>
      <StockLevels />
    </ProtectedRoute>
  )
}

function StockLevels() {
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [stockLevels, setStockLevels] = useState([])
  const [tally, setTally] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchStockLevels()
  }, [])

  const fetchStockLevels = async () => {
    setLoading(true)
    try {
      const client = getConvexHttpClient()
      const [data, tallyRows] = await Promise.all([
        client.query(api.inventory.listStockLevels, {}),
        client.query(api.inventory.stockTally, {}),
      ])
      setStockLevels(data || [])
      setTally(tallyRows || [])
      setError(null)
    } catch (err) {
      console.error('Error fetching stock levels:', err)
      showToast('error', 'Failed to load stock levels')
      setError('Failed to load stock levels. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const getStockStatus = (current, minimum) => {
    if (current <= minimum * 0.5) return 'critical'
    if (current <= minimum * 1.2) return 'low'
    return 'good'
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'critical':
        return 'text-red-600 bg-red-50'
      case 'low':
        return 'text-yellow-600 bg-yellow-50'
      case 'good':
        return 'text-green-600 bg-green-50'
      default:
        return 'text-muted bg-foam-deep/40'
    }
  }

  const tallyById = Object.fromEntries(
    (tally || []).map((r) => [r.feed_type_id, r]),
  )

  return (
    <div className="min-h-screen bg-foam">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link
              href="/dashboard"
              className="text-lagoon-800 hover:text-lagoon-950 flex items-center"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </Link>
            <h1 className="text-2xl font-bold text-chart-ink">Stock Levels</h1>
          </div>
          <div className="flex gap-2">
            <Link
              href="/feed-issue"
              className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-md border border-lagoon-800 text-lagoon-800 hover:bg-white"
            >
              Issue feed
            </Link>
            <button
              onClick={fetchStockLevels}
              className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-md text-white bg-lagoon-800 hover:bg-lagoon-950"
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

        <div className="page-card overflow-hidden">
          <div className="px-6 py-4 border-b border-foam-deep">
            <h2 className="font-medium text-chart-ink">
              On-hand stock (kg + bags)
            </h2>
            <p className="text-xs text-muted mt-1">
              Stock changes only through the inventory ledger. Tally column must
              match.
            </p>
          </div>

          {loading ? (
            <div className="py-12 text-center text-muted">Loading…</div>
          ) : stockLevels.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-foam-deep">
                <thead className="bg-foam-deep/40">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">
                      Feed Type
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">
                      Supplier
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase">
                      kg
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase">
                      Bags
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase">
                      Bag size
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase">
                      Min kg
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">
                      Ledger tally
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase">
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-foam-deep">
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
                        <td className="px-4 py-3 text-sm text-right font-mono">
                          {Number(item.current_stock).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-mono">
                          {Number(item.current_stock_bags || 0).toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-mono">
                          {Number(item.bag_size_kg || 25).toFixed(0)}
                        </td>
                        <td className="px-4 py-3 text-sm text-right font-mono">
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
                        <td className="px-4 py-3 text-sm">
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
                        <td className="px-4 py-3 text-sm text-right font-mono">
                          ₵{Number(item.stock_value || 0).toFixed(2)}
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
      </div>
    </div>
  )
}
