import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import {
  AlertTriangle,
  Package,
  RefreshCw,
  Bell,
  TrendingUp,
  TrendingDown,
} from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { PageHeader } from '../components/ui'
import { useToast } from '../components/Toast'
import { getConvexHttpClient, api } from '../lib/convexBridge'

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
      const client = getConvexHttpClient()
      const data = await client.query(api.inventory.listAlerts, {})
      setAlerts(data || [])
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
        return 'text-muted bg-foam-deep/40'
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
    <Layout title="Inventory Alerts">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Inventory', href: '/inventory/overview' },
          { label: 'Alerts' },
        ]}
        description="Low-stock and critical inventory warnings for feed types."
        related={[
          { label: 'Stock levels', href: '/stock-levels' },
          { label: 'Feed purchases', href: '/feed-purchases' },
          { label: 'Ledger', href: '/inventory-transactions' },
        ]}
        actions={
          <button
            onClick={fetchAlerts}
            className="inline-flex items-center px-3 py-2 text-sm font-semibold rounded-xl text-white bg-lagoon-950 hover:bg-lagoon-800 min-h-10"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </button>
        }
      />

        {error && (
          <div className="mb-4 bg-red-50 text-red-700 p-3 rounded-md text-sm">
            {error}
          </div>
        )}

        <div className="page-card overflow-hidden">
          <div className="px-6 py-4 border-b border-foam-deep">
            <h2 className="font-medium text-chart-ink">Active Alerts</h2>
          </div>

          {loading ? (
            <div className="py-12 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-lagoon-800 mx-auto"></div>
              <p className="mt-3 text-muted">Loading alerts...</p>
            </div>
          ) : alerts.length > 0 ? (
            <div className="divide-y divide-foam-deep">
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
                          <h3 className="text-sm font-medium text-chart-ink">
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
                        <p className="mt-1 text-sm text-muted">
                          {getAlertMessage(item)}
                        </p>
                        <div className="mt-2 text-sm text-muted">
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
              <Bell className="h-12 w-12 text-muted mx-auto" />
              <p className="mt-3 text-muted">No active alerts.</p>
            </div>
          )}
        </div>
    </Layout>
  )
} 