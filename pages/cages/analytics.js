import React from 'react'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../../components/ProtectedRoute'
import Layout from '../../components/Layout'
import { ArrowLeft, TrendingUp } from 'lucide-react'
import { Card, EmptyState, GradientButton, KpiStrip, LoadingState } from '../../components/ui'
import { useT } from '../../lib/i18n/context'
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

const COLORS = ['var(--cyan)', 'var(--pink)', 'var(--good)', 'var(--warn)', 'var(--alert)', 'var(--muted)']
const TOOLTIP_STYLE = {
  background: 'var(--surface-2)',
  border: '1px solid var(--line-strong)',
  borderRadius: 12,
  color: 'var(--text)',
}
const CHART_TITLE = 'mb-4 text-[17px] font-semibold leading-[22px] text-text'

export default function CageAnalyticsPage() {
  return (
    <ProtectedRoute>
      <CageAnalytics />
    </ProtectedRoute>
  )
}

function CageAnalytics() {
  const t = useT()
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

  const shell = (children) => (
    <Layout
      title={t('cageAnalytics.title')}
      eyebrow={t('cageAnalytics.eyebrow')}
      actions={
        <>
          <GradientButton reverse icon={TrendingUp} href="/cages/analytics/growth">
            {t('cageAnalytics.growthLink')}
          </GradientButton>
          <GradientButton reverse icon={ArrowLeft} href="/cages">
            {t('cageAnalytics.backToCages')}
          </GradientButton>
        </>
      }
    >
      {children}
    </Layout>
  )

  if (cages === undefined) {
    return shell(<LoadingState />)
  }

  if (!cages || cages.length === 0) {
    return shell(
      <Card>
        <EmptyState title={t('cageAnalytics.empty')} />
      </Card>,
    )
  }

  return shell(
      <div className="flex flex-col gap-6">
        {/* Summary Cards */}
        {analyticsData && (
          <Card>
            <KpiStrip
              items={[
                { key: 'total', label: t('cageAnalytics.kpiTotal'), value: analyticsData.totalCages },
                { key: 'active', label: t('cageAnalytics.kpiActive'), value: analyticsData.activeCages, valueTone: 'good' },
                { key: 'harvested', label: t('cageAnalytics.kpiHarvested'), value: analyticsData.harvestedCages },
                { key: 'maint', label: t('cageAnalytics.kpiMaintenance'), value: analyticsData.maintenanceCages, valueTone: 'warn' },
                { key: 'fallow', label: t('cageAnalytics.kpiFallow'), value: analyticsData.fallowCages },
                { key: 'empty', label: t('cageAnalytics.kpiEmpty'), value: analyticsData.emptyCages },
              ]}
            />
          </Card>
        )}
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Status Distribution */}
          <Card className="min-w-0">
            <h2 className={CHART_TITLE}>{t('cageAnalytics.chart.status')}</h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={analytics.statusDistribution}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    outerRadius={80}
                    fill="var(--cyan)"
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
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Size Distribution */}
          <Card className="min-w-0">
            <h2 className={CHART_TITLE}>{t('cageAnalytics.chart.size')}</h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={analytics.sizeDistribution}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    outerRadius={80}
                    fill="var(--cyan)"
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
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Harvest Readiness */}
          <Card className="min-w-0">
            <h2 className={CHART_TITLE}>{t('cageAnalytics.chart.harvest')}</h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.harvestReadiness}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="cageName" stroke="var(--line-strong)" tick={{ fontSize: 12, fill: 'var(--muted)' }} />
                  <YAxis stroke="var(--line-strong)" tick={{ fontSize: 12, fill: 'var(--muted)' }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="daysToHarvest" fill="var(--cyan)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Growth Trends */}
          <Card className="min-w-0">
            <h2 className={CHART_TITLE}>{t('cageAnalytics.chart.growth')}</h2>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={analytics.growthTrends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="cageName" stroke="var(--line-strong)" tick={{ fontSize: 12, fill: 'var(--muted)' }} />
                  <YAxis stroke="var(--line-strong)" tick={{ fontSize: 12, fill: 'var(--muted)' }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="growthRate" fill="var(--pink)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      </div>,
  )
} 