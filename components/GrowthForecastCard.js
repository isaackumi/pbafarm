import { useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { formatDate, localToday } from '../lib/format'
import { useT } from '../lib/i18n/context'
import { Badge, Input, Select } from './ui'

const ForecastChart = dynamic(() => import('./charts/GrowthForecastChart'), {
  ssr: false,
  loading: () => <div className="h-full" />,
})

const n0 = (v) => (v == null ? '—' : Math.round(v).toLocaleString())

/**
 * The unit's growth card with its forecast (AI-004): sampled ABW, the
 * projection and its range, when the fish reach a target weight (species
 * grade, species/farm target or typed), and what the forecast is based on.
 * Always labelled as an estimate.
 */
export default function GrowthForecastCard({ unitId, samples, stockingDate, className = '' }) {
  const t = useT()
  const { user } = useAuth()
  const asOf = localToday()
  const [choice, setChoice] = useState('default')
  const [custom, setCustom] = useState('')
  const customG = Number(custom)
  const targetAbwG =
    choice === 'custom' ? (customG > 0 ? customG : undefined) : choice === 'default' ? undefined : Number(choice)
  const f = useQuery(
    api.forecasts.forUnit,
    user && unitId ? { unitId, asOf, ...(targetAbwG ? { targetAbwG } : {}) } : 'skip',
  )

  const points = useMemo(
    () =>
      [...(samples || [])]
        .map((r) => ({ date: r.date, abw: Number(r.average_body_weight ?? r.averageBodyWeight) }))
        .filter((r) => r.abw > 0 && (!stockingDate || r.date >= stockingDate))
        .sort((a, b) => (a.date < b.date ? -1 : 1)),
    [samples, stockingDate],
  )

  const plan = f?.plan
  const g = plan?.target_g
  // The default target (species, else farm rule) as last seen with no choice made.
  const fallback = useRef(null)
  if (f && choice === 'default') fallback.current = { g, source: f.target_source }
  let headline = null
  if (plan) {
    if (plan.ready) headline = t('forecast.ready', { g: n0(g) })
    else if (!plan.expected) headline = t('forecast.notWithinYear', { g: n0(g) })
    else if (!plan.latest) headline = t('forecast.reachesFrom', { g: n0(g), from: formatDate(plan.earliest) })
    else if (plan.earliest === plan.latest) headline = t('forecast.reachesAround', { g: n0(g), date: formatDate(plan.expected) })
    else headline = t('forecast.reaches', { g: n0(g), from: formatDate(plan.earliest), to: formatDate(plan.latest) })
  }

  const notes = []
  if (f) {
    notes.push(
      f.method === 'species_curve'
        ? t('forecast.speciesCurve')
        : t('forecast.fitted', { n: f.points, temp: f.temperature.c }),
    )
    if (f.method === 'fitted' && f.few_samples) notes.push(t('forecast.fewSamples', { n: f.points }))
    if (f.temperature.source === 'default') notes.push(t('forecast.tempDefault', { temp: f.temperature.c }))
    if (f.feed.limited) notes.push(t('forecast.feedLimited', { rate: f.feed.rate_pct_bw, fcr: f.feed.fcr }))
  }

  return (
    <section
      aria-labelledby="growth-title"
      className={`flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface px-[26px] py-6 shadow-[var(--shadow-card)] lg:grow-[1.4] lg:basis-0 ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="growth-title" className="flex items-center gap-2 text-[15px] font-semibold leading-[18px] text-text">
          {t('cageDetail.growth')}
          {f ? <Badge tone="cyan">{t('forecast.estimate')}</Badge> : null}
        </h2>
        {f ? (
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="forecast-target" className="text-xs text-muted">
              {t('forecast.targetWeight')}
            </label>
            <Select id="forecast-target" size="sm" value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="default">
                {fallback.current?.source === 'farm'
                  ? t('forecast.farmTarget', { g: n0(fallback.current.g) })
                  : t('forecast.speciesTarget', { g: n0(fallback.current?.g) })}
              </option>
              {f.grades.map((gr) => (
                <option key={gr.key} value={String(gr.min_g)}>
                  {t('forecast.grade', { label: gr.label, g: n0(gr.min_g) })}
                </option>
              ))}
              <option value="custom">{t('forecast.custom')}</option>
            </Select>
            {choice === 'custom' ? (
              <Input
                type="number"
                min="1"
                inputMode="decimal"
                aria-label={t('forecast.grams')}
                placeholder={t('forecast.grams')}
                className="!w-24"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {f ? (
        <>
          <p className="text-[15px] font-semibold text-text" aria-live="polite">
            {headline}
          </p>
          {plan?.expected_biomass_kg != null ? (
            <p className="text-sm text-muted">
              {t('forecast.harvest', {
                count: n0(plan.expected_count),
                kg: n0(plan.expected_biomass_kg),
                low: n0(plan.biomass_low_kg ?? plan.expected_biomass_kg),
                high: n0(plan.biomass_high_kg ?? plan.expected_biomass_kg),
              })}
            </p>
          ) : null}
          <div className="h-56">
            <ForecastChart
              samples={points}
              series={f.series}
              asOf={f.as_of}
              targetG={g}
              labels={{
                actual: t('forecast.actual'),
                expected: t('forecast.expected'),
                band: t('forecast.band'),
                target: t('forecast.target', { g: n0(g) }),
                today: t('forecast.today'),
              }}
            />
          </div>
          <ul className="flex flex-col gap-1 text-xs text-muted">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
            <li>{t('forecast.disclaimer')}</li>
          </ul>
        </>
      ) : f === null ? (
        points.length >= 2 ? (
          <div className="h-56">
            <ForecastChart
              samples={points}
              series={[]}
              asOf={asOf}
              labels={{ actual: t('cageDetail.actualAbw'), expected: '', band: '', target: '', today: t('forecast.today') }}
            />
          </div>
        ) : (
          <p className="py-10 text-center text-sm text-muted">{t('cageDetail.growthEmpty')}</p>
        )
      ) : (
        <div className="h-56 animate-pulse rounded-card bg-surface-2" />
      )}
    </section>
  )
}
