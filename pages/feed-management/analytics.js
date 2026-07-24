// Feed analytics stub
import React, { useState, useEffect } from 'react'
import Layout from '../../components/Layout'
import { feedService } from '../../lib/feedService'

const FeedAnalytics = () => {
  const [analytics, setAnalytics] = useState({
    usageStats: null,
    costAnalysis: null,
    lowStockAlerts: []
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
        feedService.getLowStockAlerts()
      ])

      setAnalytics({
        usageStats: usageStats.data,
        costAnalysis: costAnalysis.data,
        lowStockAlerts: lowStockAlerts.data || []
      })
    } catch (error) {
      console.error('Error loading analytics:', error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <Layout>
        <div className="flex justify-center items-center h-64">
          <div className="text-lg">Loading feed analytics...</div>
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="max-w-6xl mx-auto">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Feed Analytics</h1>
          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="border rounded px-3 py-2"
          >
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="1y">Last year</option>
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold text-gray-600">Total Usage</h3>
            <p className="text-2xl font-bold text-blue-600">
              {analytics.usageStats?.totalUsage?.toFixed(1) || '0'} kg
            </p>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold text-gray-600">Total Cost</h3>
            <p className="text-2xl font-bold text-green-600">
              ${analytics.costAnalysis?.totalCost?.toFixed(2) || '0'}
            </p>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold text-gray-600">Avg Cost/kg</h3>
            <p className="text-2xl font-bold text-orange-600">
              ${analytics.costAnalysis?.averageCostPerKg?.toFixed(2) || '0'}
            </p>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold text-gray-600">Low Stock Alerts</h3>
            <p className="text-2xl font-bold text-red-600">
              {analytics.lowStockAlerts.length}
            </p>
          </div>
        </div>

        {analytics.lowStockAlerts.length > 0 && (
          <div className="bg-white p-6 rounded-lg shadow mb-8">
            <h2 className="text-xl font-semibold mb-4 text-red-600">Low Stock Alerts</h2>
            <div className="space-y-2">
              {analytics.lowStockAlerts.map((alert, index) => (
                <div key={index} className="flex justify-between items-center p-3 bg-red-50 rounded">
                  <span className="font-medium">{alert.name}</span>
                  <span className="text-red-600">
                    {alert.currentStock} kg remaining (Min: {alert.minimumStock} kg)
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">Usage by Feed Type</h2>
            <div className="space-y-3">
              {analytics.usageStats?.byFeedType && Object.entries(analytics.usageStats.byFeedType).map(([type, usage]) => (
                <div key={type} className="flex justify-between">
                  <span>{type}</span>
                  <span className="font-semibold">{usage.toFixed(1)} kg</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-semibold mb-4">Usage by Cage</h2>
            <div className="space-y-3">
              {analytics.usageStats?.byCage && Object.entries(analytics.usageStats.byCage).map(([cage, usage]) => (
                <div key={cage} className="flex justify-between">
                  <span>{cage}</span>
                  <span className="font-semibold">{usage.toFixed(1)} kg</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}

export default FeedAnalytics