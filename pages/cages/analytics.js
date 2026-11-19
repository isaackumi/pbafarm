import React from 'react'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { PageHeader, Button, StatCard, LoadingState, EmptyState } from '../../components/ui'
import { api } from '../../convex/_generated/api'
import { useLocation } from '../../contexts/LocationContext'
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

const COLORS = ['var(--lake)', 'var(--kelp)', '#d97706', 'var(--signal)', 'var(--muted)']

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
  const { locationArgs } = useLocation()
  const cages = useQuery(api.cages.list, locationArgs)

  const analyticsData = React.useMemo(() => {
    if (!cages) return null
    const count = (status) => cages.filter((c) => c.status === status).length
    return {
      totalCages: cages.length,
      activeCages: count('active'),
      harvestedCages: count('harvested'),
      maintenanceCages: count('maintenance'),
      fallowCages: count('fallow'),
      emptyCages: count('empty'),
    }
  }, [cages])

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

  if (cages === undefined) {
    return <LoadingState />
  }

  if (!cages || cages.length === 0) {
    return (
      <div className="w-full">
        <div className="max-w-7xl mx-auto">
          <EmptyState title="No cage data available." />
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
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
            <StatCard label="Total cages" value={analyticsData.totalCages} />
            <StatCard label="Active" value={analyticsData.activeCages} tone="good" />
            <StatCard label="Harvested" value={analyticsData.harvestedCages} />
            <StatCard label="Maintenance" value={analyticsData.maintenanceCages} tone="warn" />
            <StatCard label="Fallow" value={analyticsData.fallowCages} />
            <StatCard label="Empty" value={analyticsData.emptyCages} />
          </div>
        )}
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Status Distribution */}
          <div className="bg-surface border border-foam-deep p-5 sm:p-6 rounded-xl shadow-sm min-w-0">
            <h2 className="font-display text-lg font-medium text-chart-ink mb-4">Status distribution</h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={analytics.statusDistribution}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    outerRadius={80}
                    fill="var(--lake)"
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
          <div className="bg-surface border border-foam-deep p-5 sm:p-6 rounded-xl shadow-sm min-w-0">
            <h2 className="font-display text-lg font-medium text-chart-ink mb-4">Size distribution</h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={analytics.sizeDistribution}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    outerRadius={80}
                    fill="var(--lake)"
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
          <div className="bg-surface border border-foam-deep p-5 sm:p-6 rounded-xl shadow-sm min-w-0">
            <h2 className="font-display text-lg font-medium text-chart-ink mb-4">Harvest readiness</h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.harvestReadiness}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--foam-deep)" />
                  <XAxis dataKey="cageName" stroke="var(--muted)" tick={{ fontSize: 12 }} />
                  <YAxis stroke="var(--muted)" tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="daysToHarvest" fill="var(--lake)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Growth Trends */}
          <div className="bg-surface border border-foam-deep p-5 sm:p-6 rounded-xl shadow-sm min-w-0">
            <h2 className="font-display text-lg font-medium text-chart-ink mb-4">Growth trends</h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.growthTrends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--foam-deep)" />
                  <XAxis dataKey="cageName" stroke="var(--muted)" tick={{ fontSize: 12 }} />
                  <YAxis stroke="var(--muted)" tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar dataKey="growthRate" fill="var(--kelp)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
} 