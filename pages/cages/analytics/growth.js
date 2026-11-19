import React from 'react'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Layout from '../../../components/Layout'
import { ArrowLeft } from 'lucide-react'
import { Card, EmptyState, GradientButton, LoadingState, Table } from '../../../components/ui'
import { formatNumber } from '../../../lib/format'
import { useT } from '../../../lib/i18n/context'

const TOOLTIP_STYLE = {
  background: 'var(--surface-2)',
  border: '1px solid var(--line-strong)',
  borderRadius: 12,
  color: 'var(--text)',
}
const CHART_TITLE = 'mb-4 text-[17px] font-semibold leading-[22px] text-text'
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
      <GrowthAnalytics />
    </ProtectedRoute>
  )
}

function GrowthAnalytics() {
  const t = useT()
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

  const shell = (children) => (
    <Layout
      title={t('cageAnalytics.growth.title')}
      eyebrow={t('cageAnalytics.growth.eyebrow')}
      actions={
        <GradientButton reverse icon={ArrowLeft} href="/cages/analytics">
          {t('cageAnalytics.growth.allAnalytics')}
        </GradientButton>
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

  const tick = { fontSize: 12, fill: 'var(--muted)' }
  const columns = [
    { key: 'cage', header: t('cageAnalytics.growth.colCage'), render: (c) => <span className="font-semibold">{c.cageName}</span> },
    { key: 'doc', header: t('cageAnalytics.growth.colDoc'), align: 'right', render: (c) => t('cageAnalytics.growth.days', { value: formatNumber(c.doc) }) },
    { key: 'initial', header: t('cageAnalytics.growth.colInitial'), align: 'right', render: (c) => `${formatNumber(c.initialWeight, { decimals: 1 })} g` },
    { key: 'current', header: t('cageAnalytics.growth.colCurrent'), align: 'right', render: (c) => `${formatNumber(c.currentWeight, { decimals: 1 })} g` },
    { key: 'rate', header: t('cageAnalytics.growth.colRate'), align: 'right', render: (c) => <span className="text-good">{c.growthRate}%</span> },
    { key: 'daily', header: t('cageAnalytics.growth.colDaily'), align: 'right', render: (c) => `${c.dailyGrowthRate}%` },
  ]

  return shell(
    <div className="flex flex-col gap-6">
      <Card className="min-w-0">
        <h2 className={CHART_TITLE}>{t('cageAnalytics.growth.rateChart')}</h2>
        <div className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={growthData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="cageName" stroke="var(--line-strong)" tick={tick} />
              <YAxis stroke="var(--line-strong)" tick={tick} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend />
              <Line type="monotone" dataKey="growthRate" name={t('cageAnalytics.growth.seriesRate')} stroke="var(--cyan)" strokeWidth={2} />
              <Line type="monotone" dataKey="dailyGrowthRate" name={t('cageAnalytics.growth.seriesDaily')} stroke="var(--pink)" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card className="min-w-0">
        <h2 className={CHART_TITLE}>{t('cageAnalytics.growth.weightChart')}</h2>
        <div className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={growthData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="cageName" stroke="var(--line-strong)" tick={tick} />
              <YAxis stroke="var(--line-strong)" tick={tick} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Legend />
              <Line type="monotone" dataKey="initialWeight" name={t('cageAnalytics.growth.seriesInitial')} stroke="var(--cyan)" strokeWidth={2} />
              <Line type="monotone" dataKey="currentWeight" name={t('cageAnalytics.growth.seriesCurrent')} stroke="var(--pink)" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Table
        title={t('cageAnalytics.growth.tableTitle')}
        columns={columns}
        rows={growthData}
        rowKey={(c) => c.cageId}
        empty={t('cageAnalytics.growth.noData')}
      />
    </div>,
  )
}
