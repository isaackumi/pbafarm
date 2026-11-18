import React from 'react'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Layout from '../../../components/Layout'
import { PageHeader, Button, LoadingState, EmptyState } from '../../../components/ui'
import { api } from '../../../convex/_generated/api'
import { useLocation } from '../../../contexts/LocationContext'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

export default function GrowthAnalyticsPage() {
  return (
    <ProtectedRoute>
      <Layout>
        <GrowthAnalytics />
      </Layout>
    </ProtectedRoute>
  )
}

function GrowthAnalytics() {
  const { locationArgs } = useLocation()
  const cages = useQuery(api.cages.getActive, locationArgs)

  // Calculate growth data
  const growthData = React.useMemo(() => {
    if (!cages || cages.length === 0) return []

    return cages
      .filter(cage => cage.stocking_date && cage.initial_weight && cage.current_weight)
      .map(cage => {
        const stockingDate = new Date(cage.stocking_date)
        const today = new Date()
        const doc = Math.floor((today - stockingDate) / (1000 * 60 * 60 * 24))
        const growthRate = ((cage.current_weight - cage.initial_weight) / cage.initial_weight) * 100

        return {
          cageId: cage.id,
          cageName: cage.name,
          doc,
          initialWeight: cage.initial_weight,
          currentWeight: cage.current_weight,
          growthRate: growthRate.toFixed(2),
          dailyGrowthRate: (growthRate / doc).toFixed(2)
        }
      })
      .sort((a, b) => b.growthRate - a.growthRate)
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
            { label: 'Analytics', href: '/cages/analytics' },
            { label: 'Growth' },
          ]}
          description="Compare growth rate and weight progress across active cages."
          related={[
            { label: 'Cage analytics', href: '/cages/analytics' },
            { label: 'Harvest analytics', href: '/cages/analytics/harvest' },
          ]}
          actions={
            <Button href="/cages/analytics" variant="secondary" size="sm">
              All analytics
            </Button>
          }
        />

        <div className="grid grid-cols-1 gap-6">
          {/* Growth Rate Chart */}
          <div className="bg-surface border border-foam-deep p-5 sm:p-6 rounded-xl shadow-sm min-w-0">
            <h2 className="font-display text-lg font-medium text-chart-ink mb-4">Growth rate</h2>
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={growthData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--foam-deep)" />
                  <XAxis dataKey="cageName" stroke="var(--muted)" tick={{ fontSize: 12 }} />
                  <YAxis stroke="var(--muted)" tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="growthRate" name="Growth rate (%)" stroke="var(--lake)" />
                  <Line type="monotone" dataKey="dailyGrowthRate" name="Daily growth rate (%)" stroke="var(--kelp)" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Weight Comparison Chart */}
          <div className="bg-surface border border-foam-deep p-5 sm:p-6 rounded-xl shadow-sm min-w-0">
            <h2 className="font-display text-lg font-medium text-chart-ink mb-4">Weight comparison</h2>
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={growthData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--foam-deep)" />
                  <XAxis dataKey="cageName" stroke="var(--muted)" tick={{ fontSize: 12 }} />
                  <YAxis stroke="var(--muted)" tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="initialWeight" name="Initial weight (g)" stroke="var(--lake)" />
                  <Line type="monotone" dataKey="currentWeight" name="Current weight (g)" stroke="var(--kelp)" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Growth Data Table */}
          <div className="bg-surface border border-foam-deep p-5 sm:p-6 rounded-xl shadow-sm min-w-0">
            <h2 className="font-display text-lg font-medium text-chart-ink mb-4">Growth data</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-foam-deep">
                <thead className="bg-foam">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted">Cage</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted">DOC</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted">Initial weight</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted">Current weight</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted">Growth rate</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted">Daily growth rate</th>
                  </tr>
                </thead>
                <tbody className="bg-surface divide-y divide-foam-deep">
                  {growthData.map((cage) => (
                    <tr key={cage.cageId}>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-chart-ink">{cage.cageName}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-muted tabular-nums">{cage.doc} days</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-muted tabular-nums">{cage.initialWeight} g</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-muted tabular-nums">{cage.currentWeight} g</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-muted tabular-nums">{cage.growthRate}%</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-muted tabular-nums">{cage.dailyGrowthRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
} 