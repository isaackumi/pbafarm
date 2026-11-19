import { useMemo } from 'react'
import { useQuery } from 'convex/react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import ProtectedRoute from '../../../components/ProtectedRoute'
import Layout from '../../../components/Layout'
import { GradientButton, KpiStrip, StatusDot, Table } from '../../../components/ui'
import { api } from '../../../convex/_generated/api'
import { useAuth } from '../../../contexts/AuthContext'
import { useLocation } from '../../../contexts/LocationContext'
import { daysBetween, formatNumber, localToday } from '../../../lib/format'
import { useLocale, useT } from '../../../lib/i18n/context'

// Days of culture at which a cage is due for harvest.
const HARVEST_DOC = 120
const SOON_DAYS = 20
const STATUS_TONE = { ready: 'good', soon: 'warn', growing: 'neutral' }
const TOOLTIP = {
  cursor: { fill: 'var(--surface-2)' },
  contentStyle: {
    background: 'var(--surface-2)',
    border: '1px solid var(--line)',
    borderRadius: 12,
    color: 'var(--text)',
    fontSize: 12,
  },
  labelStyle: { color: 'var(--muted)' },
}
const AXIS = { axisLine: false, tickLine: false, tick: { fill: 'var(--faint)', fontSize: 12 } }

/** Active stocked cages with days of culture and days left to harvest, soonest first. */
function harvestReadiness(cages, today) {
  return (cages || [])
    .filter((c) => c.stocking_date)
    .map((c) => {
      const doc = daysBetween(c.stocking_date, today)
      const daysToHarvest = Math.max(0, HARVEST_DOC - doc)
      return {
        id: c.id || c._id,
        name: c.name,
        doc,
        daysToHarvest,
        initialWeight: c.initial_weight || 0,
        currentWeight: c.current_weight || 0,
        growthRate: c.growth_rate ?? null,
        status: daysToHarvest <= 0 ? 'ready' : daysToHarvest <= SOON_DAYS ? 'soon' : 'growing',
      }
    })
    .sort((a, b) => a.daysToHarvest - b.daysToHarvest)
}

function ChartCard({ title, children }) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface px-[26px] py-6 shadow-[var(--shadow-card)]">
      <h2 className="text-[15px] font-semibold leading-[18px] text-text">{title}</h2>
      <div className="h-72">{children}</div>
    </section>
  )
}

function HarvestAnalytics() {
  const t = useT()
  const { locale } = useLocale()
  const { user } = useAuth()
  const { locationArgs } = useLocation()
  const activeCages = useQuery(api.cages.getActive, user ? locationArgs : 'skip')
  const today = localToday()
  const rows = useMemo(() => harvestReadiness(activeCages, today), [activeCages, today])
  const loaded = activeCages !== undefined
  const count = (s) => rows.filter((r) => r.status === s).length
  const legend = { wrapperStyle: { fontSize: 12, color: 'var(--muted)' } }

  const columns = [
    { key: 'name', header: t('harvestPage.analytics.col.cage') },
    { key: 'doc', header: t('harvestPage.analytics.col.doc'), align: 'right', render: (r) => t('harvestPage.analytics.days', { n: r.doc }) },
    { key: 'left', header: t('harvestPage.analytics.col.daysLeft'), align: 'right', render: (r) => t('harvestPage.analytics.days', { n: r.daysToHarvest }) },
    { key: 'initial', header: t('harvestPage.analytics.col.initial'), align: 'right', render: (r) => `${formatNumber(r.initialWeight, { locale })} g` },
    { key: 'current', header: t('harvestPage.analytics.col.current'), align: 'right', render: (r) => `${formatNumber(r.currentWeight, { locale })} g` },
    {
      key: 'growth',
      header: t('harvestPage.analytics.col.growth'),
      align: 'right',
      render: (r) => (r.growthRate == null ? '—' : `${formatNumber(r.growthRate, { locale, decimals: 1 })}%`),
    },
    {
      key: 'status',
      header: t('harvestPage.analytics.col.status'),
      render: (r) => (
        <span className="flex items-center gap-2">
          <StatusDot tone={STATUS_TONE[r.status]} />
          <span className="text-[13px] leading-4 text-muted">{t.or(`harvestPage.analytics.status.${r.status}`, r.status)}</span>
        </span>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-[28px]">
      <KpiStrip
        items={[
          { key: 'ready', label: t('harvestPage.analytics.status.ready'), value: loaded ? count('ready') : '—', valueTone: count('ready') ? 'good' : undefined },
          { key: 'soon', label: t('harvestPage.analytics.kpiSoon', { n: SOON_DAYS }), value: loaded ? count('soon') : '—', valueTone: count('soon') ? 'warn' : undefined },
          { key: 'growing', label: t('harvestPage.analytics.status.growing'), value: loaded ? count('growing') : '—' },
          { key: 'stocked', label: t('harvestPage.analytics.kpiStocked'), value: loaded ? rows.length : '—' },
        ]}
      />
      {rows.length > 0 && (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <ChartCard title={t('harvestPage.analytics.readiness')}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis dataKey="name" {...AXIS} />
                <YAxis {...AXIS} width={36} />
                <Tooltip {...TOOLTIP} />
                <Legend {...legend} />
                <Bar dataKey="doc" name={t('harvestPage.analytics.col.doc')} fill="var(--cyan)" radius={[6, 6, 0, 0]} />
                <Bar dataKey="daysToHarvest" name={t('harvestPage.analytics.col.daysLeft')} fill="var(--pink)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title={t('harvestPage.analytics.weights')}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <CartesianGrid vertical={false} stroke="var(--line)" />
                <XAxis dataKey="name" {...AXIS} />
                <YAxis {...AXIS} width={44} />
                <Tooltip {...TOOLTIP} formatter={(v, name) => [`${formatNumber(v, { locale })} g`, name]} />
                <Legend {...legend} />
                <Bar dataKey="initialWeight" name={t('harvestPage.analytics.col.initial')} fill="var(--line-strong)" radius={[6, 6, 0, 0]} />
                <Bar dataKey="currentWeight" name={t('harvestPage.analytics.col.current')} fill="var(--cyan)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}
      <Table
        title={t('harvestPage.analytics.table')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        empty={loaded ? t('harvestPage.analytics.empty') : t('ui.loading')}
      />
    </div>
  )
}

export default function HarvestAnalyticsPage() {
  const t = useT()
  return (
    <ProtectedRoute>
      <Layout
        title={t('harvestPage.analytics.title')}
        eyebrow={t('harvestPage.analytics.eyebrow')}
        actions={
          <GradientButton href="/cages/analytics" variant="outline">
            {t('harvestPage.analytics.all')}
          </GradientButton>
        }
      >
        <HarvestAnalytics />
      </Layout>
    </ProtectedRoute>
  )
}
