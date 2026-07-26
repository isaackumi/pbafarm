import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import { useToast } from '../components/Toast'
import { getConvexHttpClient, api } from '../lib/convexBridge'

export default function InventoryTransactionsPage() {
  return (
    <ProtectedRoute>
      <InventoryTransactions />
    </ProtectedRoute>
  )
}

function InventoryTransactions() {
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [transactions, setTransactions] = useState([])
  const [feedTypes, setFeedTypes] = useState({})
  const [error, setError] = useState(null)
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().setDate(new Date().getDate() - 30))
      .toISOString()
      .split('T')[0],
    end: new Date().toISOString().split('T')[0],
  })

  useEffect(() => {
    fetchTransactions()
  }, [dateRange])

  const fetchTransactions = async () => {
    setLoading(true)
    try {
      const client = getConvexHttpClient()
      const types = await client.query(api.feed.listFeedTypes, {})
      const typeMap = {}
      for (const t of types || []) {
        typeMap[t.id || t._id] = t
      }
      setFeedTypes(typeMap)

      const dateFrom = new Date(dateRange.start).getTime()
      const dateTo = new Date(dateRange.end + 'T23:59:59').getTime()
      const data = await client.query(api.inventory.listTransactions, {
        dateFrom,
        dateTo,
        limit: 500,
      })
      setTransactions(data || [])
      setError(null)
    } catch (err) {
      console.error('Error fetching transactions:', err)
      showToast('error', 'Failed to load transactions')
      setError('Failed to load transactions. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-foam">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center">
            <Link
              href="/dashboard"
              className="text-lagoon-800 hover:text-lagoon-950 flex items-center mr-4"
            >
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </Link>
            <h1 className="text-2xl font-bold text-chart-ink">
              Inventory Ledger
            </h1>
          </div>
          <button
            onClick={fetchTransactions}
            className="inline-flex items-center px-4 py-2 text-sm font-medium rounded-md text-white bg-lagoon-800 hover:bg-lagoon-950"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </button>
        </div>

        <div className="mb-4 flex gap-4 items-end">
          <div>
            <label className="block text-xs text-muted mb-1">From</label>
            <input
              type="date"
              value={dateRange.start}
              onChange={(e) =>
                setDateRange((p) => ({ ...p, start: e.target.value }))
              }
              className="border border-input-border rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">To</label>
            <input
              type="date"
              value={dateRange.end}
              onChange={(e) =>
                setDateRange((p) => ({ ...p, end: e.target.value }))
              }
              className="border border-input-border rounded-md px-3 py-2 text-sm"
            />
          </div>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 text-red-700 p-3 rounded-md text-sm">
            {error}
          </div>
        )}

        <div className="page-card overflow-hidden">
          {loading ? (
            <div className="py-12 text-center text-muted">Loading…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-foam-deep">
                <thead className="bg-foam-deep/40">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">
                      When
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">
                      Type
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">
                      Feed
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase">
                      kg
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted uppercase">
                      Bags
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted uppercase">
                      Notes
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {transactions.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-8 text-center text-muted"
                      >
                        No ledger rows in this range.
                      </td>
                    </tr>
                  ) : (
                    transactions.map((t) => {
                      const ft = feedTypes[t.feed_type_id]
                      const signed = t.quantity_kg
                      return (
                        <tr key={t.id || t._id}>
                          <td className="px-4 py-3 text-sm font-mono text-chart-ink">
                            {new Date(t.transaction_date).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-sm capitalize">
                            {String(t.transaction_type).replace('_', ' ')}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {ft?.name || t.feed_type_id}
                          </td>
                          <td
                            className={`px-4 py-3 text-sm text-right font-mono ${
                              signed < 0 ? 'text-signal' : 'text-kelp'
                            }`}
                          >
                            {signed > 0 ? '+' : ''}
                            {Number(signed).toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-mono">
                            {t.bags != null ? Number(t.bags).toFixed(2) : '—'}
                          </td>
                          <td className="px-4 py-3 text-sm text-muted">
                            {t.notes || '—'}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
