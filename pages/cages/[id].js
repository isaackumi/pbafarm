import React, { useMemo, useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { useQuery } from 'convex/react'
import { ArrowLeftRight, ClipboardPen, Archive, Pencil } from 'lucide-react'
import Layout from '../../components/Layout'
import ProtectedRoute from '../../components/ProtectedRoute'
import { Button, EmptyState, GhostButton, GradientButton, KpiStrip, LoadingState, StatusDot, Table } from '../../components/ui'
import CageManageModals from '../../components/CageManageModals'
import { useAuth } from '../../contexts/AuthContext'
import { api } from '../../convex/_generated/api'
import { WQ_PARAMETERS } from '../../convex/lib/waterQuality'
import Waterline from '../../components/Waterline'
import { formatDate, localToday, unitLabel } from '../../lib/format'
import BatchHistory from '../../components/BatchHistory'
import UnitProfile from '../../components/UnitProfile'
import UnitTabs from '../../components/UnitTabs'
import { usePermission, usePermissions } from '../../hooks/usePermission'
import { routePermission } from '../../lib/routePermissions'
import { CustomFieldsCard } from '../../components/CustomFields'
import RationSuggestion from '../../components/RationSuggestion'
import GrowthForecastCard from '../../components/GrowthForecastCard'
import FarmAlerts from '../../components/FarmAlerts'
import { useT } from '../../lib/i18n/context'

const n1 = (v, unit = '') =>
  v == null ? '—' : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit}`

const WATER_NOW = ['dissolvedOxygen', 'temperatureC', 'ph', 'ammonia', 'secchiCm']
const WATER_WINDOW_MS = 14 * 86400000

const cardClass = 'rounded-card border border-line bg-surface shadow-[var(--shadow-card)]'

function rangeText(range) {
  if (!range) return ''
  if (range.min != null && range.max != null) return `${range.min} – ${range.max}`
  if (range.min != null) return `≥ ${range.min}`
  if (range.max != null) return `< ${range.max}`
  return ''
}

/** "Water now" (Paper 03): the latest reading of the last 14 days against the unit's thresholds. */
function WaterNow({ unitId }) {
  const t = useT()
  const { user } = useAuth()
  const since = useMemo(() => Date.now() - WATER_WINDOW_MS, [])
  const log = useQuery(api.waterQuality.listForUnit, user && unitId ? { unitId, since } : 'skip')
  const latest = log?.rows?.[0]
  const bad = new Set((latest?.breaches || []).map((b) => b.parameter))
  const keys = latest
    ? [...WATER_NOW.filter((k) => latest.values[k] != null), ...Object.keys(latest.values).filter((k) => !WATER_NOW.includes(k) && WQ_PARAMETERS[k])].slice(0, 6)
    : []
  return (
    <section aria-labelledby="water-now-title" className={`flex flex-col gap-1 px-[26px] py-6 ${cardClass}`}>
      <div className="flex items-center justify-between gap-2 pb-[10px]">
        <h2 id="water-now-title" className="text-[15px] font-semibold leading-[18px] text-text">
          {t('cageDetail.waterNow')}
        </h2>
        {latest && (
          <span className="text-xs leading-4 text-muted">
            {t('cageDetail.loggedAt', { when: latest.date || new Date(latest.measuredAt).toLocaleString() })}
          </span>
        )}
      </div>
      {log === undefined ? (
        <LoadingState />
      ) : !latest ? (
        <p className="border-t border-line py-4 text-sm text-muted">{t('cageDetail.noWater')}</p>
      ) : (
        <ul>
          {keys.map((k) => {
            const spec = WQ_PARAMETERS[k]
            const breach = bad.has(k)
            return (
              <li key={k} className="flex items-center gap-[14px] border-t border-line py-[11px]">
                <StatusDot tone={breach ? 'alert' : 'good'} size={7} label={breach ? t('cageDetail.outOfRange') : t('cageDetail.inRange')} />
                <span className="grow basis-0 text-[14px] leading-[18px] text-text">{spec.label}</span>
                <span className="w-[90px] shrink-0 text-right text-xs leading-4 text-faint">{rangeText(log.thresholds?.[k])}</span>
                <span className={`w-[84px] shrink-0 text-right text-[14px] font-medium leading-[18px] tabular-nums ${breach ? 'text-alert' : 'text-text'}`}>
                  {n1(latest.values[k])} {spec.unit}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** The rest of the cycle maths, kept from the previous growth panel. */
function CycleCard({ growth, cage }) {
  const t = useT()
  if (!growth || !growth.stocking_date) return null
  const rows = [
    [t('cageDetail.feedUsed'), n1(growth.feed_kg, ' kg')],
    [t('cageDetail.sgr'), growth.sgr_pct_day == null ? '—' : `${growth.sgr_pct_day.toFixed(2)} %/d`],
    [t('cageDetail.adg'), growth.adg_g_day == null ? '—' : `${growth.adg_g_day.toFixed(2)} g/d`],
    [t('cageDetail.mortality'), `${n1(growth.mortality)} / ${n1(growth.stocked_count)}`],
    [t('cageDetail.stockedBiomass'), n1(growth.initial_biomass_kg, ' kg')],
    [t('cageDetail.feedCost'), n1(growth.feed_cost)],
  ]
  return (
    <section aria-labelledby="cycle-title" className={`flex flex-col gap-4 p-6 ${cardClass}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="cycle-title" className="text-[15px] font-semibold leading-[18px] text-text">
          {growth.cycle_closed ? t('cageDetail.lastCycle') : t('cageDetail.currentCycle')}
        </h2>
        <span className="text-xs text-muted tabular-nums">
          {t('cageDetail.dayOf', { day: growth.days_of_culture ?? '—' })}
        </span>
      </div>
      <div>
        <div className="mb-1.5 flex justify-between text-xs text-muted tabular-nums">
          <span>{t('cageDetail.fishCount', { count: growth.live_count ?? 0 })}</span>
          <span>{cage.capacity ? t('cageDetail.ofCapacity', { capacity: n1(cage.capacity) }) : t('cageDetail.noCapacity')}</span>
        </div>
        <Waterline count={growth.live_count} capacity={cage.capacity} />
      </div>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-1">
            <dt className="text-xs uppercase tracking-[0.06em] text-faint">{k}</dt>
            <dd className="text-[14px] font-medium tabular-nums text-text">{v}</dd>
          </div>
        ))}
      </dl>
      {!growth.abw_measured_on && <p className="text-xs text-muted">{t('cageDetail.notSampled')}</p>}
    </section>
  )
}

function RecentLog({ daily, samples }) {
  const t = useT()
  const [tab, setTab] = useState('daily')
  const dailyColumns = [
    { key: 'date', header: t('cageDetail.col.date'), width: 110, render: (r) => formatDate(r.date) },
    { key: 'feed', header: t('cageDetail.col.feed'), align: 'right', render: (r) => n1(r.feed_amount ?? r.feedAmount, ' kg') },
    {
      key: 'mort',
      header: t('cageDetail.col.mortality'),
      align: 'right',
      render: (r) => <span className={(r.mortality ?? 0) > 0 ? 'text-alert' : ''}>{r.mortality ?? 0}</span>,
    },
    { key: 'cause', header: t('cageDetail.col.cause'), render: (r) => <span className="text-muted">{r.mortality_cause || '—'}</span> },
    { key: 'do', header: t('cageDetail.col.do'), align: 'right', render: (r) => n1(r.dissolved_oxygen) },
    { key: 'temp', header: t('cageDetail.col.temp'), align: 'right', render: (r) => n1(r.temperature_c) },
  ]
  const sampleColumns = [
    { key: 'date', header: t('cageDetail.col.date'), width: 110, render: (r) => formatDate(r.date) },
    { key: 'abw', header: t('cageDetail.col.abw'), align: 'right', render: (r) => n1(r.average_body_weight ?? r.averageBodyWeight, ' g') },
  ]
  return (
    <Table
      title={t('cageDetail.recentLog')}
      tabsLabel={t('cageDetail.recentLog')}
      tabs={[
        { value: 'daily', label: t('cageDetail.tab.daily') },
        { value: 'sampling', label: t('cageDetail.tab.sampling') },
      ]}
      tab={tab}
      onTabChange={setTab}
      columns={tab === 'daily' ? dailyColumns : sampleColumns}
      rows={(tab === 'daily' ? daily : samples || []).slice(0, 10)}
      empty={tab === 'daily' ? t('cageDetail.noDaily') : t('cageDetail.noSamples')}
    />
  )
}

function CageDetails() {
  const t = useT()
  const router = useRouter()
  const { user } = useAuth()
  const { can } = usePermissions()
  const isAdmin = usePermission('production.stock.adjust')
  const canEdit = usePermission('production.units.manage')
  const id = typeof router.query.id === 'string' ? router.query.id : null

  const cage = useQuery(api.cages.get, user && id ? { id } : 'skip')
  const recentDaily = useQuery(api.dailyRecords.list, user && id ? { cageId: id } : 'skip')
  const recentBiweekly = useQuery(api.biweeklyRecords.list, user && id ? { cageId: id } : 'skip')
  const ws = useQuery(api.units.workspace, user && id ? { id } : 'skip')
  const growth = useQuery(api.cages.growth, user && id ? { id, asOf: localToday() } : 'skip')

  const [editCage, setEditCage] = useState(null)
  const [deleteCage, setDeleteCage] = useState(null)

  if (cage === undefined || !id) {
    return (
      <Layout title={t('cageDetail.unit')}>
        <LoadingState label={t('cageDetail.loading')} />
      </Layout>
    )
  }

  if (cage === null) {
    return (
      <Layout title={t('cageDetail.unit')}>
        <EmptyState title={t('cageDetail.notFound')} action={<Button href="/cages">{t('cageDetail.back')}</Button>} />
      </Layout>
    )
  }

  const cageId = cage.id || cage._id
  const dailyRows = recentDaily || []
  const g = growth && growth.stocking_date ? growth : null
  const allowed = (href) => can(routePermission(href))

  const eyebrow = [
    <Link key="list" href="/cages" className="hover:text-text hover:underline">
      {unitLabel(cage, { plural: true })}
    </Link>,
    ws?.group?.name,
    cage.species,
    g?.batch_number ? t('cageDetail.batch', { batch: g.batch_number }) : null,
    g?.stocking_date ? t('cageDetail.stocked', { date: formatDate(g.stocking_date) }) : null,
    ws?.status?.label,
  ]
    .filter(Boolean)
    .flatMap((part, i) => (i === 0 ? [part] : [i === 1 ? ' / ' : ' · ', part]))

  const biomassKg = g?.current_biomass_kg
  const kpis = [
    {
      key: 'fish',
      label: t('cageDetail.kpi.fish'),
      value: n1(g?.live_count ?? cage.current_count ?? cage.currentCount),
      suffix: g?.stocked_count ? t('cageDetail.of', { count: n1(g.stocked_count) }) : undefined,
    },
    {
      key: 'abw',
      label: t('cageDetail.kpi.abw'),
      value: n1(g?.current_abw_g ?? cage.current_weight, ' g'),
      suffix: g?.abw_measured_on ? t('cageDetail.sampled', { date: formatDate(g.abw_measured_on) }) : undefined,
    },
    {
      key: 'biomass',
      label: t('cageDetail.kpi.biomass'),
      value: biomassKg == null ? '—' : biomassKg >= 1000 ? `${n1(biomassKg / 1000)} t` : `${n1(biomassKg)} kg`,
      suffix: ws?.density?.density != null ? `${n1(ws.density.density)} ${ws.density.unit}` : undefined,
      suffixTone: ws?.density?.level === 'over' ? 'alert' : 'muted',
    },
    {
      key: 'fcr',
      label: t('cageDetail.kpi.fcr'),
      value: g?.efcr == null ? '—' : g.efcr.toFixed(2),
      valueTone: g?.efcr == null ? undefined : g.efcr <= 1.6 ? 'good' : g.efcr > 2 ? 'alert' : undefined,
    },
    {
      key: 'survival',
      label: t('cageDetail.kpi.survival'),
      value: g?.survival_pct == null ? '—' : `${g.survival_pct}%`,
      valueTone: g?.survival_pct != null && g.survival_pct < 80 ? 'alert' : undefined,
    },
  ]

  const quick = [
    { href: `/biweekly-entry?cage=${cageId}`, label: t('cageDetail.biweekly') },
    { href: `/water-entry?unit=${cageId}`, label: t('cageDetail.waterReading') },
    { href: `/inspection-entry?unit=${cageId}`, label: t('cageDetail.inspection') },
    ...(isAdmin ? [{ href: `/grading?cage=${cageId}`, label: t('cageDetail.grade') }] : []),
  ].filter((q) => allowed(q.href))

  return (
    <Layout
      title={cage.name}
      eyebrow={eyebrow}
      actions={
        <>
          {allowed('/daily-entry') && (
            <GradientButton href={`/daily-entry?cage=${cageId}`} icon={ClipboardPen}>
              {t('cageDetail.logEntry')}
            </GradientButton>
          )}
          {allowed('/fish-transfers') && (
            <GradientButton href={`/fish-transfers?source=${cageId}`} reverse icon={ArrowLeftRight}>
              {t('cageDetail.transfer')}
            </GradientButton>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-7">
        <UnitTabs unitId={cageId} active="overview" unitType={ws?.unitType} />

        <KpiStrip items={kpis} />

        {(quick.length > 0 || canEdit || isAdmin) && (
          <div className="flex flex-wrap gap-2">
            {quick.map((q) => (
              <GhostButton key={q.href} href={q.href} size="sm">
                {q.label}
              </GhostButton>
            ))}
            {canEdit && (
              <GhostButton size="sm" icon={Pencil} onClick={() => setEditCage(cage)}>
                {t('cageDetail.edit')}
              </GhostButton>
            )}
            {isAdmin && (
              <GhostButton size="sm" tone="danger" icon={Archive} onClick={() => setDeleteCage(cage)}>
                {t('cageDetail.archive')}
              </GhostButton>
            )}
          </div>
        )}

        <RationSuggestion cageId={cageId} detailed />
        <FarmAlerts unitId={cageId} compact />

        <div className="flex flex-col gap-5 lg:flex-row">
          <GrowthForecastCard unitId={cageId} samples={recentBiweekly} stockingDate={growth?.stocking_date} />
          <div className="flex min-w-0 flex-col lg:grow lg:basis-0">
            <WaterNow unitId={cageId} />
          </div>
        </div>

        <RecentLog daily={dailyRows} samples={recentBiweekly} />

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <CycleCard growth={growth} cage={cage} />
          <UnitProfile ws={ws} isAdmin={isAdmin} />
        </div>

        <BatchHistory cageId={cageId} />

        <CustomFieldsCard
          entity="cages"
          recordId={cageId}
          values={cage.custom}
          locationId={cage.location_id}
          core={{ unitType: cage.unit_type ?? cage.unitType, status: cage.status }}
          editPermission="production.units.manage"
        />
      </div>

      <CageManageModals
        editCage={editCage}
        deleteCage={deleteCage}
        onCloseEdit={() => setEditCage(null)}
        onCloseDelete={() => setDeleteCage(null)}
        onDeleted={() => router.push('/cages')}
      />
    </Layout>
  )
}

export default function CageDetailsPage() {
  return (
    <ProtectedRoute>
      <CageDetails />
    </ProtectedRoute>
  )
}
