import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import {
  ArrowLeft,
  Package,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Filter,
  Calendar,
} from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import { useToast } from '../components/Toast'
import { supabase } from '../lib/supabase'

export default function InventoryTransactionsPage() {
  return (
    <ProtectedRoute>
      <InventoryTransactions />
    </ProtectedRoute>
  )
}

function InventoryTransactions() {
  const router = useRouter()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [transactions, setTransactions] = useState([])
  const [error, setError] = useState(null)
  const [dateRange, setDateRange] = useState({
    start: new Date(new Date().setDate(new Date().getDate() - 30)).toISOString().split('T')[0],
    end: new Date().toISOString().split('T')[0],
  })

  useEffect(() => {
    fetchTransactions()
  }, [dateRange])

  const fetchTransactions = async () => {
    setLoading(true)
    try {
      // Fetch feed purchases
      const { data: purchases, error: purchasesError } = await supabase
        .from('feed_purchases')
        .select(`
          *,
          feed_type:feed_types(name),
          supplier:feed_suppliers(name)
        `)
        .gte('purchase_date', dateRange.start)
        .lte('purchase_date', dateRange.end)
        .order('purchase_date', { ascending: false })

      if (purchasesError) throw purchasesError

      // Fetch feed usage
      const { data: usage, error: usageError } = await supabase
        .from('feed_usage')
        .select(`
          *,
          feed_type:feed_types(name),
          cage:cages(name)
        `)
        .gte('usage_date', dateRange.start)
        .lte('usage_date', dateRange.end)
        .order('usage_date', { ascending: false })

      if (usageError) throw usageError

      // Combine and sort transactions
      const allTransactions = [
        ...(purchases || []).map(p => ({
          ...p,
          type: 'purchase',
          date: p.purchase_date,
          quantity: p.quantity,
          value: p.total_cost,
        })),
        ...(usage || []).map(u => ({
          ...u,
          type: 'usage',
          date: u.usage_date,
          quantity: u.quantity,
          value: u.quantity * (u.feed_type?.price_per_kg || 0),
        })),
      ].sort((a, b) => new Date(b.date) - new Date(a.date))

      setTransactions(allTransactions)
    } catch (error) {
      console.error('Error fetching transactions:', error)
      showToast('error', 'Failed to load transactions')
      setError('Failed to load transactions. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleDateRangeChange = (e) => {
    const { name, value } = e.target
    setDateRange(prev => ({
      ...prev,
      [name]: value
    }))
  }

  return (
    <div className="min-h-screen bg-gray-100">
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
            <h1 className="text-2xl font-bold text-gray-900">Inventory Transactions</h1>
          </div>

          <button
            onClick={fetchTransactions}
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </button>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 text-red-700 p-3 rounded-md text-sm">
            {error}
          </div>
        )}

        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-gray-700">Transaction History</h2>
              <div className="flex items-center space-x-4">
                <div className="flex items-center">
                  <Calendar className="h-4 w-4 text-gray-400 mr-2" />
                  <input
                    type="date"
                    name="start"
                    value={dateRange.start}
                    onChange={handleDateRangeChange}
                    className="border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  />
                  <span className="mx-2 text-gray-500">to</span>
                  <input
                    type="date"
                    name="end"
                    value={dateRange.end}
                    onChange={handleDateRangeChange}
                    className="border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  />
                </div>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="py-12 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
              <p className="mt-3 text-gray-500">Loading transactions...</p>
            </div>
          ) : transactions.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Feed Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Quantity
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Value
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Details
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {transactions.map((transaction) => (
                    <tr key={`${transaction.type}-${transaction.id}`}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(transaction.date).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            transaction.type === 'purchase'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {transaction.type === 'purchase' ? 'Purchase' : 'Usage'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {transaction.feed_type?.name || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {transaction.quantity?.toFixed(2)} kg
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        ₵{transaction.value?.toFixed(2)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {transaction.type === 'purchase' ? (
                          <>
                            Supplier: {transaction.supplier?.name || 'N/A'}
                            <br />
                            Price/kg: ₵{transaction.price_per_kg?.toFixed(2)}
                          </>
                        ) : (
                          <>
                            Cage: {transaction.cage?.name || 'N/A'}
                            <br />
                            Notes: {transaction.notes || 'N/A'}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="py-12 text-center">
              <Package className="h-12 w-12 text-gray-400 mx-auto" />
              <p className="mt-3 text-gray-500">No transactions found for the selected date range.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
} 