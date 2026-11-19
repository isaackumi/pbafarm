import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/router'
import { useQuery } from 'convex/react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { Card, CardHeader, EmptyState, ErrorState, Field, PageHeader, Select, Skeleton, StatCard, TabBar } from '../components/ui'
import { api } from '../convex/_generated/api'
import { useLocation } from '../contexts/LocationContext'
import { errorMessage } from '../lib/errorMessage'
import { useT } from '../lib/i18n/context'

const WaterQualityChart = dynamic(() => import('../components/charts/WaterQualityChart'), {
  ssr: false,
  loading: () => <Skeleton className="h-full" />,
})

/**
 * Sensor analytics (ANLY-006): per-unit min/max/avg over sensor readings
 * (INT-007), threshold breaches and a time series chart. Breaches of
 * oxygen, temperature, pH and ammonia also notify people (see doc 09 §8).
 */

const HOUR = 3_600_000
const RANGES = { '24h': 24 * HOUR, '7d': 7 * 24 * HOUR, '30d': 30 * 24 * HOUR }

function fmt(n) {
  if (n == null || !Number.isFinite(n)) return '—'
  return Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2).replace(/\.?0+$/, '')
}

function formatTime(ms) {
  if (!ms) return '—'
  try {
    return new Date(ms).toLocaleString()
  } catch {
    return '—'
  }
}

function useSafeQuery(fn, args) {
  try {
    return { data: useQuery(fn, args), error: null }
  } catch (err) {
    return { data: undefined, error: err }
  }
}

function SeriesCard({ unitId, parameter, from, to }) {
  const t = useT()
  const { data, error } = useSafeQuery(api.sensorAnalytics.series, { unitId, parameter, from, to })
  if (error) return <ErrorState title={t('integ.sensors.errorTitle')} message={errorMessage(error)} />
  if (data === undefined) return <Skeleton className="h-72" />
  if (data === null) return <EmptyState title={t('integ.sensors.notFound')} />
  const points = data.buckets.map((b) => ({ t: b.t, v: Math.round(b.avg * 100) / 100 }))
  return (
    <Card>
      <CardHeader
        title={`${data.unitName} · ${data.label}`}
        subtitle={t('integ.sensors.seriesHint', { minutes: Math.round(data.bucketMs / 60_000) })}
      />
      {data.stats ? (
        <div className="mb-4 grid gap-3 sm:grid-cols-4">
          <StatCard label={t('integ.sensors.min')} value={fmt(data.stats.min)} unit={data.unit} />
          <StatCard label={t('integ.sensors.avg')} value={fmt(data.stats.avg)} unit={data.unit} />
          <StatCard label={t('integ.sensors.max')} value={fmt(data.stats.max)} unit={data.unit} />
          <StatCard
            label={t('integ.sensors.breaches')}
            value={data.breaches.low + data.breaches.high}
            tone={data.breaches.low + data.breaches.high > 0 ? 'warn' : 'good'}
            hint={t('integ.sensors.lowHigh', { low: data.breaches.low, high: data.breaches.high })}
          />
        </div>
      ) : null}
      {points.length === 0 ? (
        <p className="text-sm text-muted">{t('integ.sensors.noReadings')}</p>
      ) : (
        <div className="h-72">
          <WaterQualityChart points={points} range={data.range} unit={data.unit} label={data.label} />
        </div>
      )}
      {data.truncated && <p className="mt-2 text-xs text-muted">{t('integ.sensors.truncated')}</p>}
    </Card>
  )
}

function SensorsPage() {
  const t = useT()
  const router = useRouter()
  const { locations = [] } = useLocation() || {}
  const [range, setRange] = useState('24h')
  const [locationId, setLocationId] = useState('')
  const [selected, setSelected] = useState(null)

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

  return (
    <div>
      <PageHeader title={t('integ.sensors.title')} description={t('integ.sensors.description')} />
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <TabBar
            label={t('integ.sensors.range')}
            tabs={Object.keys(RANGES).map((k) => ({ id: k, label: t(`integ.sensors.range${k}`) }))}
            active={range}
            onChange={setRange}
          />
          <Field label={t('integ.acct.site')} htmlFor="sensor-site" className="sm:w-64">
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
          </Field>
        </div>

        {error ? (
          <ErrorState title={t('integ.sensors.errorTitle')} message={errorMessage(error)} />
        ) : data === undefined ? (
          <Skeleton className="h-40" />
        ) : data.rows.length === 0 ? (
          <EmptyState title={t('integ.sensors.emptyTitle')} description={t('integ.sensors.emptyHint')} />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <StatCard label={t('integ.sensors.units')} value={data.units} />
              <StatCard label={t('integ.sensors.breachingUnits')} value={data.breachingUnits} tone={data.breachingUnits > 0 ? 'warn' : 'good'} />
            </div>
            {selected && <SeriesCard key={`${selected.unitId}:${selected.parameter}:${range}`} {...selected} from={from} to={to} />}
            <Card>
              <CardHeader title={t('integ.sensors.summaryTitle')} subtitle={t('integ.sensors.summaryHint')} />
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs uppercase text-muted">
                    <tr>
                      <th className="py-2 pr-3">{t('integ.sensors.unit')}</th>
                      <th className="py-2 pr-3">{t('integ.sensors.parameter')}</th>
                      <th className="py-2 pr-3 text-right">{t('integ.sensors.min')}</th>
                      <th className="py-2 pr-3 text-right">{t('integ.sensors.avg')}</th>
                      <th className="py-2 pr-3 text-right">{t('integ.sensors.max')}</th>
                      <th className="py-2 pr-3 text-right">{t('integ.sensors.last')}</th>
                      <th className="py-2 pr-3 text-right">{t('integ.sensors.breaches')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-foam-deep">
                    {data.rows.map((r) => {
                      const breaches = r.low + r.high
                      const active = selected && selected.unitId === r.unitId && selected.parameter === r.parameter
                      return (
                        <tr
                          key={`${r.unitId}:${r.parameter}`}
                          className={`cursor-pointer hover:bg-foam ${active ? 'bg-foam' : ''}`}
                          onClick={() => setSelected({ unitId: r.unitId, parameter: r.parameter })}
                        >
                          <td className="py-2 pr-3 font-medium text-chart-ink">{r.unitName}</td>
                          <td className="py-2 pr-3">
                            {r.label}
                            {r.unit ? <span className="text-muted"> ({r.unit})</span> : null}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">{fmt(r.min)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{fmt(r.avg)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{fmt(r.max)}</td>
                          <td className="py-2 pr-3 text-right tabular-nums" title={formatTime(r.lastAt)}>
                            {fmt(r.last)}
                          </td>
                          <td className={`py-2 pr-3 text-right tabular-nums ${breaches > 0 ? 'font-semibold text-signal' : 'text-muted'}`}>
                            {breaches > 0 ? t('integ.sensors.lowHigh', { low: r.low, high: r.high }) : '0'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {data.truncated && <p className="mt-2 text-xs text-muted">{t('integ.sensors.truncated')}</p>}
            </Card>
          </>
        )}
      </div>
    </div>
  )
}

export default function Sensors() {
  return (
    <ProtectedRoute permission="production.view">
      <Layout>
        <SensorsPage />
      </Layout>
    </ProtectedRoute>
  )
}
