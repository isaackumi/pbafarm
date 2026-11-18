// Feed analytics stub
import React, { useState, useEffect } from 'react'
import Layout from '../../components/Layout'
import ProtectedRoute from '../../components/ProtectedRoute'
import { PageHeader, StatCard, Card, Select } from '../../components/ui'
import { feedService } from '../../lib/feedService'
import { useMoney } from '../../lib/money'

const FeedAnalytics = () => {
  const money = useMoney()
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
            }
          />

          {loading ? (
            <p className="text-muted text-sm">Loading analytics…</p>
          ) : (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                <StatCard
                  label="Total usage"
                  value={analytics.usageStats?.totalUsage?.toFixed(1) || '0'}
                  unit="kg"
                />
                <StatCard
                  label="Total cost"
                  value={money(analytics.costAnalysis?.totalCost || 0)}
                />
                <StatCard
                  label="Average cost per kg"
                  value={money(analytics.costAnalysis?.averageCostPerKg || 0)}
                />
                <StatCard
                  label="Low stock alerts"
                  value={analytics.lowStockAlerts.length}
                  tone={analytics.lowStockAlerts.length > 0 ? 'warn' : 'default'}
                />
              </div>

              {analytics.lowStockAlerts.length > 0 && (
                <Card className="mb-8">
                  <h2 className="text-lg font-medium mb-4 text-signal">Low stock alerts</h2>
                  <div className="space-y-2">
                    {analytics.lowStockAlerts.map((alert, index) => (
                      <div
                        key={index}
                        className="flex flex-wrap justify-between items-center gap-x-4 gap-y-1 p-3 rounded-xl border border-signal/25 bg-signal/10"
                      >
                        <span className="font-medium text-chart-ink">{alert.name}</span>
                        <span className="text-signal text-sm font-data tabular-nums shrink-0">
                          {alert.currentStock} kg remaining (min {alert.minimumStock} kg)
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card>
                  <h2 className="text-lg font-medium text-chart-ink mb-4">Usage by feed type</h2>
                  <div className="space-y-3">
                    {analytics.usageStats?.byFeedType &&
                      Object.entries(analytics.usageStats.byFeedType).map(([type, usage]) => (
                        <div key={type} className="flex justify-between gap-4">
                          <span>{type}</span>
                          <span className="font-medium font-data tabular-nums">{usage.toFixed(1)} kg</span>
                        </div>
                      ))}
                  </div>
                </Card>

                <Card>
                  <h2 className="text-lg font-medium text-chart-ink mb-4">Usage by cage</h2>
                  <div className="space-y-3">
                    {analytics.usageStats?.byCage &&
                      Object.entries(analytics.usageStats.byCage).map(([cage, usage]) => (
                        <div key={cage} className="flex justify-between gap-4">
                          <span>{cage}</span>
                          <span className="font-medium font-data tabular-nums">{usage.toFixed(1)} kg</span>
                        </div>
                      ))}
                  </div>
                </Card>
              </div>
            </>
          )}
        </div>
      </Layout>
    </ProtectedRoute>
  )
}

export default FeedAnalytics
