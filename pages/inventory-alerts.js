import { useQuery } from 'convex/react'
import {
  AlertTriangle,
  Package,
  Bell,
  TrendingUp,
  TrendingDown,
} from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { PageHeader, Button, LoadingState } from '../components/ui'
import { api } from '../convex/_generated/api'
import { useMoney } from '../lib/money'
import { useLocation } from '../contexts/LocationContext'

export default function InventoryAlertsPage() {
  return (
    <ProtectedRoute>
      <InventoryAlerts />
    </ProtectedRoute>
  )
}

function InventoryAlerts() {
  const money = useMoney()
  const { locationArgs } = useLocation()
  const alertsResult = useQuery(api.inventory.listAlerts, locationArgs)
  const loading = alertsResult === undefined
  const alerts = alertsResult || []

  const getAlertSeverity = (current, minimum) => {
    if (current <= minimum * 0.5) return 'critical'
    if (current <= minimum * 0.8) return 'high'
    return 'medium'
  }

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical':
        return 'text-signal bg-signal/10'
      case 'high':
        return 'text-warn bg-warn/20'
      case 'medium':
        return 'text-warn bg-warn/10'
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
      return `High priority: Stock is at ${percentage.toFixed(0)}% of minimum level`
    }
    return `Medium priority: Stock is at ${percentage.toFixed(0)}% of minimum level`
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
      />

        <div className="page-card overflow-hidden">
          <div className="px-6 py-4 border-b border-foam-deep">
            <h2 className="font-medium text-chart-ink">Active alerts</h2>
          </div>

          {loading ? (
            <LoadingState label="Loading alerts..." />
          ) : alerts.length > 0 ? (
            <div className="divide-y divide-foam-deep">
              {alerts.map((item) => {
                const severity = getAlertSeverity(item.current_stock, item.minimum_stock)
                return (
                  <div key={item.id} className="p-4 sm:p-6">
                    <div className="flex items-start">
                      <div className="flex-shrink-0">
                        <AlertTriangle className={`h-6 w-6 ${getSeverityColor(severity).split(' ')[0]}`} />
                      </div>
                      <div className="ml-4 flex-1">
                        <div className="flex items-center justify-between gap-3">
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
                        <div className="mt-2 text-sm text-muted tabular-nums">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                            <div>
                              <span className="font-medium">Current stock:</span>{' '}
                              {item.current_stock?.toFixed(2)} kg
                            </div>
                            <div>
                              <span className="font-medium">Minimum stock:</span>{' '}
                              {item.minimum_stock?.toFixed(2)} kg
                            </div>
                            <div>
                              <span className="font-medium">Supplier:</span>{' '}
                              {item.supplier?.name || 'N/A'}
                            </div>
                            <div>
                              <span className="font-medium">Value:</span>{' '}
                              {money(item.current_stock * item.price_per_kg)}
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