import React, { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Layout from '../../../components/Layout'
import { PageHeader, Button } from '../../../components/ui'
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
import { fetchActiveCages, selectActiveCages, selectCagesLoading, selectCagesError } from '../../../store/slices/cagesSlice'

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
  const dispatch = useDispatch()
  const cages = useSelector(selectActiveCages)
  const loading = useSelector(selectCagesLoading)
  const error = useSelector(selectCagesError)

  useEffect(() => {
    dispatch(fetchActiveCages())
  }, [dispatch])

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

  if (loading) {
    return (
      <div className="w-full">
        <div className="max-w-7xl mx-auto">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-lake border-t-transparent"></div>
            <p className="mt-2 text-muted">Loading growth analytics…</p>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="w-full">
        <div className="max-w-7xl mx-auto">
          <div className="bg-signal/10 border border-signal/30 rounded-lg p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-signal" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-signal">Error</h3>
                <div className="mt-2 text-sm text-signal">
                  <p>{error}</p>
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