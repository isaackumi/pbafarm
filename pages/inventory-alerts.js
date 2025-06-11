import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import {
  ArrowLeft,
  AlertTriangle,
  Package,
  RefreshCw,
  Bell,
  TrendingUp,
  TrendingDown,
} from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import { useToast } from '../components/Toast'
import { supabase } from '../lib/supabase'

export default function InventoryAlertsPage() {
  return (
    <ProtectedRoute>
      <InventoryAlerts />
    </ProtectedRoute>
  )
}

function InventoryAlerts() {
  const router = useRouter()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(true)
  const [alerts, setAlerts] = useState([])
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchAlerts()
  }, [])

  const fetchAlerts = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('feed_types')
        .select(`
          *,
          supplier:feed_suppliers(name)
        `)
        .eq('active', true)
        .order('name')

      if (error) throw error

      // Filter for items that need attention
      const alerts = (data || []).filter(item => {
        const currentStock = item.current_stock || 0
        const minimumStock = item.minimum_stock || 0
        return currentStock <= minimumStock * 1.2 // Alert if stock is at or below 120% of minimum
      })

      setAlerts(alerts)
    } catch (error) {
      console.error('Error fetching alerts:', error)
      showToast('error', 'Failed to load alerts')
      setError('Failed to load alerts. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const getAlertSeverity = (current, minimum) => {
    if (current <= minimum * 0.5) return 'critical'
    if (current <= minimum * 0.8) return 'high'
    return 'medium'
  }

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical':
        return 'text-red-600 bg-red-50'
      case 'high':
        return 'text-orange-600 bg-orange-50'
      case 'medium':
        return 'text-yellow-600 bg-yellow-50'
      default:
        return 'text-gray-600 bg-gray-50'
    }
  }

  const getAlertMessage = (item) => {
    const current = item.current_stock || 0
    const minimum = item.minimum_stock || 0
    const percentage = (current / minimum) * 100

    if (current <= minimum * 0.5) {
      return `Critical: Stock is at ${percentage.toFixed(0)}% of minimum level`
    }
    if (current <= minimum * 0.8) {
      return `High Priority: Stock is at ${percentage.toFixed(0)}% of minimum level`
    }
    return `Medium Priority: Stock is at ${percentage.toFixed(0)}% of minimum level`
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
            <h1 className="text-2xl font-bold text-gray-900">Inventory Alerts</h1>
          </div>

          <button
            onClick={fetchAlerts}
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
            <h2 className="font-medium text-gray-700">Active Alerts</h2>
          </div>

          {loading ? (
            <div className="py-12 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
              <p className="mt-3 text-gray-500">Loading alerts...</p>
            </div>
          ) : alerts.length > 0 ? (
            <div className="divide-y divide-gray-200">
              {alerts.map((item) => {
                const severity = getAlertSeverity(item.current_stock, item.minimum_stock)
                return (
                  <div key={item.id} className="p-6">
                    <div className="flex items-start">
                      <div className="flex-shrink-0">
                        <AlertTriangle className={`h-6 w-6 ${getSeverityColor(severity).split(' ')[0]}`} />
                      </div>
                      <div className="ml-4 flex-1">
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-medium text-gray-900">
                            {item.name}
                          </h3>
                          <span
                            className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${getSeverityColor(
                              severity
                            )}`}
                          >
                            {severity.charAt(0).toUpperCase() + severity.slice(1)}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-gray-500">
                          {getAlertMessage(item)}
                        </p>
                        <div className="mt-2 text-sm text-gray-500">
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <span className="font-medium">Current Stock:</span>{' '}
                              {item.current_stock?.toFixed(2)} kg
                            </div>
                            <div>
                              <span className="font-medium">Minimum Stock:</span>{' '}
                              {item.minimum_stock?.toFixed(2)} kg
                            </div>
                            <div>
                              <span className="font-medium">Supplier:</span>{' '}
                              {item.supplier?.name || 'N/A'}
                            </div>
                            <div>
                              <span className="font-medium">Value:</span>{' '}
                              ₵{(item.current_stock * item.price_per_kg).toFixed(2)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="py-12 text-center">
              <Bell className="h-12 w-12 text-gray-400 mx-auto" />
              <p className="mt-3 text-gray-500">No active alerts.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
} 