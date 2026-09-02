import React, { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { PageHeader, Button } from '../../components/ui'
import { fetchCages } from '../../store/slices/cagesSlice'
import { useAuth } from '../../contexts/AuthContext'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'
import { analyticsService } from '../../lib/databaseService'

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884D8']

export default function CageAnalyticsPage() {
  return (
    <ProtectedRoute>
      <Layout>
        <CageAnalytics />
      </Layout>
    </ProtectedRoute>
  )
}

function CageAnalytics() {
  const dispatch = useDispatch()
  const { user, loading: authLoading } = useAuth()
  const { cages, loading: reduxLoading, error: reduxError } = useSelector(
    (state) => state.cages,
  )
  const [analyticsData, setAnalyticsData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (authLoading || !user) return

    const loadData = async () => {
      try {
        setLoading(true)
        setError(null)

        let cageList = cages
        if (!cageList || cageList.length === 0) {
          const result = await dispatch(fetchCages({ page: 1, pageSize: 100 }))
          cageList = result?.payload?.data || cageList || []
        }

        // Derive stats locally from already-authenticated cage data when possible
        if (cageList?.length) {
          setAnalyticsData({
            totalCages: cageList.length,
            activeCages: cageList.filter((c) => c.status === 'active').length,
            harvestedCages: cageList.filter((c) => c.status === 'harvested')
              .length,
            maintenanceCages: cageList.filter((c) => c.status === 'maintenance')
              .length,
            fallowCages: cageList.filter((c) => c.status === 'fallow').length,
            emptyCages: cageList.filter((c) => c.status === 'empty').length,
          })
        } else {
          const { data, error: analyticsError } =
            await analyticsService.getCageSummaryStats()
          if (analyticsError) throw analyticsError
          setAnalyticsData(data)
        }
      } catch (err) {
        console.error('Error loading analytics:', err)
        setError('Failed to load analytics data. Please try again.')
      } finally {
        setLoading(false)
      }
    }

    loadData()
    // Intentionally omit cages from deps to avoid refetch loops; we load once auth is ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, user, authLoading])

  // Calculate analytics from cages data if analytics service fails
  const analytics = React.useMemo(() => {
    if (!cages || cages.length === 0) {
      return {
        statusDistribution: [],
        sizeDistribution: [],
        harvestReadiness: [],
        growthTrends: []
      }
    }

    // Status distribution
    const statusCounts = cages.reduce((acc, cage) => {
      const status = cage.status || 'unknown'
      acc[status] = (acc[status] || 0) + 1
      return acc
    }, {})

    const statusDistribution = Object.entries(statusCounts).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value
    }))

    // Size distribution
    const sizeRanges = {
      'Small (<100m³)': 0,
      'Medium (100-200m³)': 0,
      'Large (>200m³)': 0
    }

    cages.forEach(cage => {
      const size = cage.size || 0
      if (size < 100) sizeRanges['Small (<100m³)']++
      else if (size <= 200) sizeRanges['Medium (100-200m³)']++
      else sizeRanges['Large (>200m³)']++
    })

    const sizeDistribution = Object.entries(sizeRanges).map(([name, value]) => ({
      name,
      value
    }))

    // Harvest readiness
    const harvestReadiness = cages
      .filter(cage => cage.status === 'active' && cage.stocking_date)
      .map(cage => {
        const stockingDate = new Date(cage.stocking_date)
        const today = new Date()
        const doc = Math.floor((today - stockingDate) / (1000 * 60 * 60 * 24))
        const daysToHarvest = Math.max(0, 120 - doc) // 120 days is the harvest threshold

        return {
          cageId: cage.id,
          cageName: cage.name,
          doc,
          daysToHarvest,
          status: daysToHarvest <= 0 ? 'Ready' : daysToHarvest <= 20 ? 'Soon' : 'Growing'
        }
      })
      .sort((a, b) => a.daysToHarvest - b.daysToHarvest)

    // Calculate growth trends
    const growthTrends = cages
      .filter(cage => cage.status === 'active' && cage.stocking_date)
      .map(cage => {
        const stockingDate = new Date(cage.stocking_date)
        const today = new Date()
        const doc = Math.floor((today - stockingDate) / (1000 * 60 * 60 * 24))
        return {
          cageId: cage.id,
          cageName: cage.name,
          doc,
          initialWeight: cage.initial_weight || 0,
          currentWeight: cage.current_weight || 0,
          growthRate: cage.growth_rate || 0
        }
      })

    return {
      statusDistribution,
      sizeDistribution,
      harvestReadiness,
      growthTrends
    }
  }, [cages])

  if (loading || reduxLoading) {
    return (
      <div className="w-full">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-lagoon-800 border-t-transparent"></div>
            <p className="mt-2 text-muted">Loading analytics...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error || reduxError) {
    return (
      <div className="w-full">
        <div className="max-w-7xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">Error</h3>
                <div className="mt-2 text-sm text-red-700">
                  <p>{error || reduxError}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!cages || cages.length === 0) {
    return (
      <div className="w-full">
        <div className="max-w-7xl mx-auto">
          <div className="text-center text-muted">No cage data available.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full">
      <div className="max-w-7xl mx-auto">
        <PageHeader
          showTitle={false}
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Cages', href: '/cages' },
            { label: 'Analytics' },
          ]}
          description="Status mix, biomass, and harvest readiness across your cages."
          related={[
            { label: 'All cages', href: '/cages' },
            { label: 'Growth', href: '/cages/analytics/growth' },
            { label: 'Harvest analytics', href: '/cages/analytics/harvest' },
          ]}
          actions={
            <Button href="/cages" variant="secondary" size="sm">
              Back to cages
            </Button>
          }
        />

        {/* Summary Cards */}
        {analyticsData && (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
            <div className="page-card p-4">
              <div className="text-sm font-medium text-muted">Total Cages</div>
              <div className="mt-2 text-2xl font-semibold text-lagoon-800">
                {analyticsData.totalCages}
              </div>
            </div>

            <div className="page-card p-4">
              <div className="text-sm font-medium text-muted">Active</div>
              <div className="mt-2 text-2xl font-semibold text-green-600">
                {analyticsData.activeCages}
              </div>
            </div>

            <div className="page-card p-4">
              <div className="text-sm font-medium text-muted">Harvested</div>
              <div className="mt-2 text-2xl font-semibold text-lagoon-800">
                {analyticsData.harvestedCages}
              </div>
            </div>

            <div className="page-card p-4">
              <div className="text-sm font-medium text-muted">Maintenance</div>
              <div className="mt-2 text-2xl font-semibold text-yellow-600">
                {analyticsData.maintenanceCages}
              </div>
            </div>

            <div className="page-card p-4">
              <div className="text-sm font-medium text-muted">Fallow</div>
              <div className="mt-2 text-2xl font-semibold text-muted">
                {analyticsData.fallowCages}
              </div>
            </div>

            <div className="page-card p-4">
              <div className="text-sm font-medium text-muted">Empty</div>
              <div className="mt-2 text-2xl font-semibold text-purple-600">
                {analyticsData.emptyCages}
              </div>
            </div>
          </div>
        )}
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Status Distribution */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-lg font-semibold text-chart-ink mb-4">Status Distribution</h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={analytics.statusDistribution}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                    label={({ name, percent, value }) =>
                      value > 0
                        ? `${name} ${(percent * 100).toFixed(0)}%`
                        : null
                    }
                  >
                    {analytics.statusDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Size Distribution */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-lg font-semibold text-chart-ink mb-4">Size Distribution</h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={analytics.sizeDistribution}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    outerRadius={80}
                    fill="#8884d8"
                    dataKey="value"
                    label={({ name, percent, value }) =>
                      value > 0
                        ? `${name} ${(percent * 100).toFixed(0)}%`
                        : null
                    }
                  >
                    {analytics.sizeDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Harvest Readiness */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-lg font-semibold text-chart-ink mb-4">Harvest Readiness</h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.harvestReadiness}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="cageName" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="daysToHarvest" fill="#8884d8" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Growth Trends */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-lg font-semibold text-chart-ink mb-4">Growth Trends</h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.growthTrends}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="cageName" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="growthRate" fill="#82ca9d" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
} 