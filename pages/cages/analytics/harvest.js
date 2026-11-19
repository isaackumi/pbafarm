import React from 'react'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Layout from '../../../components/Layout'
import { PageHeader, Button, LoadingState, EmptyState } from '../../../components/ui'
import { api } from '../../../convex/_generated/api'
import { useLocation } from '../../../contexts/LocationContext'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

export default function HarvestAnalyticsPage() {
  return (
    <ProtectedRoute>
      <Layout>
        <HarvestAnalytics />
      </Layout>
    </ProtectedRoute>
  )
}

function HarvestAnalytics() {
  const { locationArgs } = useLocation()
  const activeCages = useQuery(api.cages.getActive, locationArgs)
  const cages = React.useMemo(
    () => activeCages?.filter(isHarvestReady),
    [activeCages],
  )

  // Calculate harvest readiness data
  const harvestData = React.useMemo(() => {
    if (!cages || cages.length === 0) return []

    return cages
      .filter(cage => cage.stocking_date)
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
          initialWeight: cage.initial_weight || 0,
          currentWeight: cage.current_weight || 0,
          growthRate: cage.growth_rate || 0,
          status: daysToHarvest <= 0 ? 'Ready' : daysToHarvest <= 20 ? 'Soon' : 'Growing'
        }
      })
      .sort((a, b) => a.daysToHarvest - b.daysToHarvest)
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
            { label: 'Harvest' },
          ]}
          description="See which cages are approaching harvest and how size grades break down."
          related={[
            { label: 'Cage analytics', href: '/cages/analytics' },
            { label: 'Growth', href: '/cages/analytics/growth' },
            { label: 'Harvest sampling', href: '/harvest-sampling' },
          ]}
          actions={
            <Button href="/cages/analytics" variant="secondary" size="sm">
              All analytics
            </Button>
          }
        />

        <div className="grid grid-cols-1 gap-6">
          {/* Harvest Readiness Chart */}
          <div className="bg-surface border border-foam-deep p-5 sm:p-6 rounded-xl shadow-sm min-w-0">
            <h2 className="font-display text-lg font-medium text-chart-ink mb-4">Harvest readiness</h2>
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={harvestData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--foam-deep)" />
                  <XAxis dataKey="cageName" stroke="var(--muted)" tick={{ fontSize: 12 }} />
                  <YAxis yAxisId="left" orientation="left" stroke="var(--lake)" />
                  <YAxis yAxisId="right" orientation="right" stroke="var(--kelp)" />
                  <Tooltip />
                  <Legend />
                  <Bar yAxisId="left" dataKey="doc" name="Days of culture" fill="var(--lake)" />
                  <Bar yAxisId="right" dataKey="daysToHarvest" name="Days to harvest" fill="var(--kelp)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Growth Rate Chart */}
          <div className="bg-surface border border-foam-deep p-5 sm:p-6 rounded-xl shadow-sm min-w-0">
            <h2 className="font-display text-lg font-medium text-chart-ink mb-4">Growth rate</h2>
            <div className="h-96">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={harvestData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--foam-deep)" />
                  <XAxis dataKey="cageName" stroke="var(--muted)" tick={{ fontSize: 12 }} />
                  <YAxis stroke="var(--muted)" tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="initialWeight" name="Initial weight" fill="var(--lake)" />
                  <Bar dataKey="currentWeight" name="Current weight" fill="var(--kelp)" />
                  <Bar dataKey="growthRate" name="Growth rate" fill="#d97706" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Harvest Ready Cages Table */}
          <div className="bg-surface border border-foam-deep p-5 sm:p-6 rounded-xl shadow-sm min-w-0">
            <h2 className="font-display text-lg font-medium text-chart-ink mb-4">Cages ready to harvest</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-foam-deep">
                <thead className="bg-foam">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted">Cage</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted">DOC</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted">Days to harvest</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted">Initial weight</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted">Current weight</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted">Growth rate</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted">Status</th>
                  </tr>
                </thead>
                <tbody className="bg-surface divide-y divide-foam-deep">
                  {harvestData.map((cage) => (
                    <tr key={cage.cageId}>
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-chart-ink">{cage.cageName}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-muted tabular-nums">{cage.doc} days</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-muted tabular-nums">{cage.daysToHarvest} days</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-muted tabular-nums">{cage.initialWeight} g</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-muted tabular-nums">{cage.currentWeight} g</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-muted tabular-nums">{cage.growthRate}%</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          cage.status === 'Ready' ? 'bg-signal/15 text-signal' :
                          cage.status === 'Soon' ? 'bg-warn/10 text-warn' :
                          'bg-kelp/15 text-kelp'
                        }`}>
                          {cage.status}
                        </span>
                      </td>
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

// Active cages at least 180 days in culture with growth rate of 80 or more.
function isHarvestReady(cage) {
  const daysOfCulture = cage.stockingDate
    ? Math.floor((new Date() - new Date(cage.stockingDate)) / (1000 * 60 * 60 * 24))
    : 0
  return daysOfCulture >= 180 && cage.growthRate >= 80
}
