// Feed analytics stub
import React, { useState, useEffect } from 'react'
import Layout from '../../components/Layout'
import ProtectedRoute from '../../components/ProtectedRoute'
import { PageHeader } from '../../components/ui'
import { feedService } from '../../lib/feedService'

const FeedAnalytics = () => {
  const [analytics, setAnalytics] = useState({
    usageStats: null,
    costAnalysis: null,
    lowStockAlerts: [],
  })
  const [loading, setLoading] = useState(true)
  const [timeRange, setTimeRange] = useState('30d')

  useEffect(() => {
    loadAnalytics()
  }, [timeRange])

  const loadAnalytics = async () => {
    try {
      setLoading(true)
      const [usageStats, costAnalysis, lowStockAlerts] = await Promise.all([
        feedService.getFeedUsageStats(timeRange),
        feedService.getFeedCostAnalysis(timeRange),
        feedService.getLowStockAlerts(),
      ])

      setAnalytics({
        usageStats: usageStats.data,
        costAnalysis: costAnalysis.data,
        lowStockAlerts: lowStockAlerts.data || [],
      })
    } catch (error) {
      console.error('Error loading feed analytics:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <ProtectedRoute>
      <Layout title="Feed Analytics">
        <div className="max-w-6xl">
          <PageHeader
            showTitle={false}
            breadcrumbs={[
              { label: 'Dashboard', href: '/dashboard' },
              { label: 'Feed', href: '/feed-management' },
              { label: 'Analytics' },
            ]}
            description="Usage, cost, and low-stock signals across feed types and cages."
            related={[
              { label: 'Feed management', href: '/feed-management' },
              { label: 'Stock levels', href: '/stock-levels' },
              { label: 'Overview', href: '/feed-management/overview' },
            ]}
            actions={
              <select
                value={timeRange}
                onChange={(e) => setTimeRange(e.target.value)}
                className="border border-zinc-200 rounded-xl px-3 py-2 text-sm bg-white shadow-sm min-h-10"
              >
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
                <option value="1y">Last year</option>
              </select>
            }
          />

          {loading ? (
            <p className="text-muted text-sm">Loading analytics…</p>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                <div className="bg-white p-6 rounded-2xl border border-zinc-200/90 shadow-sm">
                  <h3 className="text-sm font-semibold text-muted">Total Usage</h3>
                  <p className="text-2xl font-bold text-lagoon-800 font-data mt-1">
                    {analytics.usageStats?.totalUsage?.toFixed(1) || '0'} kg
                  </p>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-zinc-200/90 shadow-sm">
                  <h3 className="text-sm font-semibold text-muted">Total Cost</h3>
                  <p className="text-2xl font-bold text-kelp font-data mt-1">
                    ${analytics.costAnalysis?.totalCost?.toFixed(2) || '0'}
                  </p>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-zinc-200/90 shadow-sm">
                  <h3 className="text-sm font-semibold text-muted">Avg Cost/kg</h3>
                  <p className="text-2xl font-bold text-chart-ink font-data mt-1">
                    ${analytics.costAnalysis?.averageCostPerKg?.toFixed(2) || '0'}
                  </p>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-zinc-200/90 shadow-sm">
                  <h3 className="text-sm font-semibold text-muted">Low Stock Alerts</h3>
                  <p className="text-2xl font-bold text-signal font-data mt-1">
                    {analytics.lowStockAlerts.length}
                  </p>
                </div>
              </div>

              {analytics.lowStockAlerts.length > 0 && (
                <div className="bg-white p-6 rounded-2xl border border-zinc-200/90 shadow-sm mb-8">
                  <h2 className="text-lg font-semibold mb-4 text-signal">Low Stock Alerts</h2>
                  <div className="space-y-2">
                    {analytics.lowStockAlerts.map((alert, index) => (
                      <div
                        key={index}
                        className="flex justify-between items-center p-3 bg-signal/5 rounded-xl"
                      >
                        <span className="font-medium">{alert.name}</span>
                        <span className="text-signal text-sm font-data">
                          {alert.currentStock} kg remaining (Min: {alert.minimumStock} kg)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-2xl border border-zinc-200/90 shadow-sm">
                  <h2 className="text-lg font-semibold mb-4">Usage by Feed Type</h2>
                  <div className="space-y-3">
                    {analytics.usageStats?.byFeedType &&
                      Object.entries(analytics.usageStats.byFeedType).map(([type, usage]) => (
                        <div key={type} className="flex justify-between">
                          <span>{type}</span>
                          <span className="font-semibold font-data">{usage.toFixed(1)} kg</span>
                        </div>
                      ))}
                  </div>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-zinc-200/90 shadow-sm">
                  <h2 className="text-lg font-semibold mb-4">Usage by Cage</h2>
                  <div className="space-y-3">
                    {analytics.usageStats?.byCage &&
                      Object.entries(analytics.usageStats.byCage).map(([cage, usage]) => (
                        <div key={cage} className="flex justify-between">
                          <span>{cage}</span>
                          <span className="font-semibold font-data">{usage.toFixed(1)} kg</span>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </Layout>
    </ProtectedRoute>
  )
}

export default FeedAnalytics
