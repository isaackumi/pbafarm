import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/router'
import { useQuery } from 'convex/react'
import { SlidersHorizontal } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import {
  EmptyState,
  ErrorState,
  GhostButton,
  GradientButton,
  KpiStrip,
  Pill,
  Select,
  Skeleton,
  StatusDot,
  Table,
  Tabs,
} from '../components/ui'
import { api } from '../convex/_generated/api'
import { useLocation } from '../contexts/LocationContext'
import { errorMessage } from '../lib/errorMessage'
import { usePermission } from '../hooks/usePermission'
import { useLocale, useT } from '../lib/i18n/context'

const WaterQualityChart = dynamic(() => import('../components/charts/WaterQualityChart'), {
  ssr: false,
  loading: () => <Skeleton className="h-full" />,
})

/**
 * Sensors & IoT (Paper 28; ANLY-006): latest value per unit and parameter
 * against its threshold range, breaches over the period and a time series
 * for the selected reading. Breaches of oxygen, temperature, pH and ammonia
 * also notify people (see doc 09 §8).
 */

const HOUR = 3_600_000
const RANGES = { '24h': 24 * HOUR, '7d': 7 * 24 * HOUR, '30d': 30 * 24 * HOUR }
// A reading older than this is shown as "quiet": the device may be offline.
const STALE_MS = 2 * HOUR
const CARD = 'rounded-card border border-line bg-surface shadow-[var(--shadow-card)]'
const TONE_TEXT = { alert: 'text-alert', warn: 'text-warn', good: 'text-good', offline: 'text-muted' }
const TONE_PILL = { alert: 'red', warn: 'amber', good: 'green', offline: 'neutral' }

function fmt(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  return Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2).replace(/\.?0+$/, '')
}

function ago(ms, now, locale) {
  if (!ms) return '—'
  const s = Math.max(0, Math.round((now - ms) / 1000))
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  if (s < 60) return rtf.format(-s, 'second')
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute')
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour')
  return rtf.format(-Math.round(s / 86400), 'day')
}

/** Status of a reading's latest value against its range. */
function readingStatus(row, now) {
  if (now - row.lastAt > STALE_MS) return 'offline'
  const r = row.range
  if (r && r.min != null && row.last < r.min) return 'alert'
  if (r && r.max != null && row.last > r.max) return 'alert'
  if (row.low + row.high > 0) return 'warn'
  return 'good'
}

function rangeText(t, row) {
  const r = row.range
  if (!r || (r.min == null && r.max == null)) return t('sensorsPage.noRange')
  const u = row.unit ? ` ${row.unit}` : ''
  if (r.min != null && row.last < r.min) return t('sensorsPage.below', { value: `${fmt(r.min)}${u}` })
  if (r.max != null && row.last > r.max) return t('sensorsPage.above', { value: `${fmt(r.max)}${u}` })
  if (r.min != null && r.max != null) return t('sensorsPage.within', { min: fmt(r.min), max: fmt(r.max) })
  return r.min != null ? t('sensorsPage.atLeast', { value: `${fmt(r.min)}${u}` }) : t('sensorsPage.atMost', { value: `${fmt(r.max)}${u}` })
}

function useSafeQuery(fn, args) {
  try {
    return { data: useQuery(fn, args), error: null }
  } catch (err) {
    return { data: undefined, error: err }
  }
}

const keyOf = (r) => `${r.unitId}:${r.parameter}`

export default function Sensors() {
  return (
    <ProtectedRoute permission="production.view">
      <SensorsPage />
    </ProtectedRoute>
  )
}

function SensorsPage() {
  const t = useT()
  const { locale } = useLocale()
  const router = useRouter()
  const { locations = [] } = useLocation() || {}
  const canEditRules = usePermission('org.settings.manage')
  const [range, setRange] = useState('24h')
  const [locationId, setLocationId] = useState('')
  const [selected, setSelected] = useState(null)
  const [tab, setTab] = useState('all')
  const [search, setSearch] = useState('')

  // Stable window per range choice (rounded to the minute) so the subscription doesn't churn.
  const { from, to } = useMemo(() => {
    const end = Math.ceil(Date.now() / 60_000) * 60_000
    return { from: end - RANGES[range], to: end }
  }, [range])

  const { data, error } = useSafeQuery(api.sensorAnalytics.summary, { from, to, ...(locationId ? { locationId } : {}) })

  // Deep link from an alert: /sensors?unit=<id> picks that unit's worst parameter.
  useEffect(() => {
    if (!data || selected) return
    const wanted = typeof router.query.unit === 'string' ? router.query.unit : null
    const pool = wanted ? data.rows.filter((r) => r.unitId === wanted) : data.rows
    if (!pool.length) return
    const pick = [...pool].sort((a, b) => b.low + b.high - (a.low + a.high))[0]
    setSelected({ unitId: pick.unitId, parameter: pick.parameter })
  }, [data, selected, router.query.unit])

  const now = to
  const rows = useMemo(() => (data?.rows || []).map((r) => ({ ...r, status: readingStatus(r, now) })), [data, now])
  const site = locations.find((l) => (l._id || l.id) === locationId)
  const latestAt = rows.reduce((m, r) => Math.max(m, r.lastAt), 0)

  const order = { alert: 0, warn: 1, offline: 2, good: 3 }
  const tiles = [...rows].sort((a, b) => order[a.status] - order[b.status] || b.low + b.high - (a.low + a.high)).slice(0, 6)

  const breaches = rows.filter((r) => r.alert).reduce((s, r) => s + r.low + r.high, 0)
  const lowDo = rows.filter((r) => r.parameter === 'dissolved_oxygen').reduce((s, r) => s + r.low, 0)
  const temps = rows.filter((r) => r.parameter === 'temperature_c')
  const quiet = rows.filter((r) => r.status === 'offline').length
  const kpis = data
    ? [
        {
          key: 'units',
          label: t('sensorsPage.kpi.reporting'),
          value: `${rows.length - quiet} / ${rows.length}`,
          suffix: quiet ? t('sensorsPage.kpi.quietN', { count: quiet }) : t('sensorsPage.kpi.unitsN', { count: data.units }),
          suffixTone: quiet ? 'alert' : 'muted',
        },
        {
          key: 'breaches',
          label: t('sensorsPage.kpi.breaches', { period: t(`integ.sensors.range${range}`) }),
          value: breaches,
          valueTone: breaches ? 'alert' : undefined,
          suffix: lowDo ? t('sensorsPage.kpi.lowDo', { count: lowDo }) : undefined,
          suffixTone: 'alert',
        },
        {
          key: 'breaching',
          label: t('integ.sensors.breachingUnits'),
          value: data.breachingUnits,
          valueTone: data.breachingUnits ? 'warn' : 'good',
        },
        ...(temps.length
          ? [
              {
                key: 'temp',
                label: t('sensorsPage.kpi.waterTemp'),
                value: `${fmt(temps.reduce((s, r) => s + r.last, 0) / temps.length)} ${temps[0].unit}`,
                suffix: t('sensorsPage.kpi.unitsAvg', { count: temps.length }),
              },
            ]
          : []),
      ]
    : []

  const q = search.trim().toLowerCase()
  const tableRows = rows.filter(
    (r) =>
      (tab === 'all' || (tab === 'alerts' ? r.low + r.high > 0 || r.status === 'alert' : r.status === 'offline')) &&
      (!q || `${r.unitName} ${r.label}`.toLowerCase().includes(q)),
  )

  const rules = []
  const seenRule = new Set()
  for (const r of rows) {
    if (!r.alert || !r.range || seenRule.has(r.parameter)) continue
    seenRule.add(r.parameter)
    rules.push(r)
  }

  const eyebrow = data
    ? t('sensorsPage.eyebrow', {
        readings: t('sensorsPage.readingsN', { count: rows.length }),
        units: t('sensorsPage.unitsOn', { count: data.units }),
        updated: ago(latestAt, Date.now(), locale),
      })
    : t('sensorsPage.eyebrowSite', { site: site?.name || t('integ.acct.allSites') })

  return (
    <Layout
      title={t('integ.sensors.title')}
      eyebrow={eyebrow}
      actions={
        canEditRules ? (
          <GradientButton href="/water-quality" icon={SlidersHorizontal} variant="outline">
            {t('sensorsPage.alertRules')}
          </GradientButton>
        ) : null
      }
    >
      <div className="flex flex-col gap-7">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            variant="chip"
            label={t('integ.sensors.range')}
            tabs={Object.keys(RANGES).map((k) => ({ value: k, label: t(`integ.sensors.range${k}`) }))}
            value={range}
            onChange={setRange}
          />
          <div className="sm:w-64">
            <label htmlFor="sensor-site" className="sr-only">
              {t('integ.acct.site')}
            </label>
            <Select
              id="sensor-site"
              value={locationId}
              onChange={(e) => {
                setLocationId(e.target.value)
                setSelected(null)
              }}
            >
              <option value="">{t('integ.acct.allSites')}</option>
              {locations.map((l) => (
                <option key={l._id || l.id} value={l._id || l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {error ? (
          <ErrorState title={t('integ.sensors.errorTitle')} message={errorMessage(error)} />
        ) : data === undefined ? (
          <Skeleton className="h-40" />
        ) : rows.length === 0 ? (
          <EmptyState title={t('integ.sensors.emptyTitle')} description={t('integ.sensors.emptyHint')} />
        ) : (
          <>
            <KpiStrip items={kpis} />

            <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {tiles.map((r) => {
                const active = selected && keyOf(selected) === keyOf(r)
                return (
                  <button
                    key={keyOf(r)}
                    type="button"
                    onClick={() => setSelected({ unitId: r.unitId, parameter: r.parameter })}
                    aria-pressed={!!active}
                    className={`${CARD} flex flex-col gap-[10px] px-6 py-[22px] text-left transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
                      active ? 'border-pearl-cyan' : ''
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] leading-4 text-muted">
                        {r.unitName} · {r.label}
                      </span>
                      <StatusDot tone={r.status} size={8} label={t(`sensorsPage.status.${r.status}`)} />
                    </span>
                    <span className="flex items-baseline gap-[6px]">
                      <span className="text-[34px] font-semibold leading-[42px] tracking-tight tabular-nums text-text">
                        {fmt(r.last)}
                      </span>
                      {r.unit && <span className="text-[14px] leading-[18px] text-muted">{r.unit}</span>}
                    </span>
                    <span className="text-xs leading-4 text-muted">
                      {t('sensorsPage.minAvgMax', { min: fmt(r.min), avg: fmt(r.avg), max: fmt(r.max) })}
                    </span>
                    <span className={`text-xs leading-4 ${TONE_TEXT[r.status]}`}>
                      {r.status === 'offline'
                        ? t('sensorsPage.quietSince', { ago: ago(r.lastAt, now, locale) })
                        : r.status === 'warn'
                          ? t('sensorsPage.breachedN', { count: r.low + r.high })
                          : rangeText(t, r)}
                    </span>
                  </button>
                )
              })}
            </div>

            {selected && <SeriesCard key={`${keyOf(selected)}:${range}`} {...selected} from={from} to={to} />}

            <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_392px]">
              <Table
                title={t('sensorsPage.readings')}
                tabsLabel={t('sensorsPage.filter')}
                tabs={[
                  { value: 'all', label: t('sensorsPage.tab.all') },
                  { value: 'alerts', label: t('sensorsPage.tab.alerts') },
                  { value: 'quiet', label: t('sensorsPage.tab.quiet') },
                ]}
                tab={tab}
                onTabChange={setTab}
                search={search}
                onSearchChange={setSearch}
                searchPlaceholder={t('sensorsPage.search')}
                rowKey={keyOf}
                onRowClick={(r) => setSelected({ unitId: r.unitId, parameter: r.parameter })}
                empty={t('sensorsPage.noMatch')}
                rows={tableRows}
                columns={[
                  {
                    key: 'reading',
                    header: t('sensorsPage.col.reading'),
                    render: (r) => <span className="font-medium text-text">{r.label}</span>,
                    sub: (r) => r.unitName,
                  },
                  {
                    key: 'last',
                    header: t('integ.sensors.last'),
                    align: 'right',
                    render: (r) => `${fmt(r.last)}${r.unit ? ` ${r.unit}` : ''}`,
                    sub: (r) => t('sensorsPage.minMax', { min: fmt(r.min), max: fmt(r.max) }),
                  },
                  {
                    key: 'breaches',
                    header: t('integ.sensors.breaches'),
                    align: 'right',
                    render: (r) =>
                      r.low + r.high > 0 ? (
                        <span className="font-semibold text-alert">{t('integ.sensors.lowHigh', { low: r.low, high: r.high })}</span>
                      ) : (
                        <span className="text-muted">0</span>
                      ),
                  },
                  {
                    key: 'seen',
                    header: t('sensorsPage.col.lastSeen'),
                    align: 'right',
                    render: (r) => <span title={new Date(r.lastAt).toLocaleString(locale)}>{ago(r.lastAt, now, locale)}</span>,
                  },
                  {
                    key: 'status',
                    header: t('sensorsPage.col.status'),
                    render: (r) => <Pill tone={TONE_PILL[r.status]}>{t(`sensorsPage.status.${r.status}`)}</Pill>,
                  },
                ]}
              />

              <section className={`${CARD} px-[22px] py-6 sm:px-[26px]`}>
                <div className="flex items-center justify-between gap-3 pb-3">
                  <h2 className="text-[15px] font-semibold leading-[18px] text-text">{t('sensorsPage.alertRules')}</h2>
                  <span className="text-[13px] leading-4 text-muted">{t('sensorsPage.rulesN', { count: rules.length })}</span>
                </div>
                {rules.length === 0 ? (
                  <p className="border-t border-line py-[11px] text-[13px] leading-[18px] text-muted">{t('sensorsPage.noRules')}</p>
                ) : (
                  <ul>
                    {rules.map((r) => (
                      <li key={r.parameter} className="flex flex-col gap-[2px] border-t border-line py-[11px]">
                        <span className="text-[14px] leading-[18px] text-text">
                          {r.range.min != null && r.range.max != null
                            ? t('sensorsPage.ruleOutside', { label: r.label, min: fmt(r.range.min), max: fmt(r.range.max), unit: r.unit })
                            : r.range.min != null
                              ? t('sensorsPage.ruleBelow', { label: r.label, value: fmt(r.range.min), unit: r.unit })
                              : t('sensorsPage.ruleAbove', { label: r.label, value: fmt(r.range.max), unit: r.unit })}
                        </span>
                        <span className="text-xs leading-4 text-muted">{t('sensorsPage.ruleNotify')}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {canEditRules && (
                  <div className="border-t border-line pt-4">
                    <GhostButton href="/water-quality" icon={SlidersHorizontal} size="sm">
                      {t('sensorsPage.editThresholds')}
                    </GhostButton>
                  </div>
                )}
              </section>
            </div>
            {data.truncated && <p className="text-xs text-muted">{t('integ.sensors.truncated')}</p>}
          </>
        )}
      </div>
    </Layout>
  )
}

function SeriesCard({ unitId, parameter, from, to }) {
  const t = useT()
  const { data, error } = useSafeQuery(api.sensorAnalytics.series, { unitId, parameter, from, to })
  if (error) return <ErrorState title={t('integ.sensors.errorTitle')} message={errorMessage(error)} />
  if (data === undefined) return <Skeleton className="h-72" />
  if (data === null) return <EmptyState title={t('integ.sensors.notFound')} />
  const points = data.buckets.map((b) => ({ t: b.t, v: Math.round(b.avg * 100) / 100 }))
  const total = data.breaches.low + data.breaches.high
  return (
    <section className={`${CARD} px-[22px] py-6 sm:px-[26px]`}>
      <div className="flex flex-wrap items-start justify-between gap-3 pb-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-[15px] font-semibold leading-[18px] text-text">
            {data.unitName} · {data.label}
          </h2>
          <p className="text-xs leading-4 text-muted">
            {t('integ.sensors.seriesHint', { minutes: Math.round(data.bucketMs / 60_000) })}
          </p>
        </div>
        {data.stats && (
          <dl className="flex flex-wrap gap-6 text-right">
            {[
              ['min', fmt(data.stats.min)],
              ['avg', fmt(data.stats.avg)],
              ['max', fmt(data.stats.max)],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-col gap-1">
                <dt className="text-[12px] uppercase leading-4 tracking-[0.06em] text-faint">{t(`integ.sensors.${k}`)}</dt>
                <dd className="text-[15px] font-semibold leading-[18px] tabular-nums text-text">
                  {v}
                  {data.unit && <span className="font-normal text-muted"> {data.unit}</span>}
                </dd>
              </div>
            ))}
            <div className="flex flex-col gap-1">
              <dt className="text-[12px] uppercase leading-4 tracking-[0.06em] text-faint">{t('integ.sensors.breaches')}</dt>
              <dd className={`text-[15px] font-semibold leading-[18px] tabular-nums ${total ? 'text-alert' : 'text-good'}`}>
                {total ? t('integ.sensors.lowHigh', { low: data.breaches.low, high: data.breaches.high }) : 0}
              </dd>
            </div>
          </dl>
        )}
      </div>
      {points.length === 0 ? (
        <p className="text-[13px] leading-5 text-muted">{t('integ.sensors.noReadings')}</p>
      ) : (
        <div className="h-72">
          <WaterQualityChart points={points} range={data.range} unit={data.unit} label={data.label} />
        </div>
      )}
      {data.truncated && <p className="mt-2 text-xs text-muted">{t('integ.sensors.truncated')}</p>}
    </section>
  )
}
