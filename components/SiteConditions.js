import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useAction, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { Card, GhostButton } from './ui'
import { useT } from '../lib/i18n/context'
import { useToast } from './Toast'
import { errorMessage } from '../lib/errorMessage'
import { addDays, localToday } from '../lib/format'

function dayName(date, today, t) {
  if (date === today) return t('siteConditions.today')
  if (date === addDays(today, 1)) return t('siteConditions.tomorrow')
  if (date === addDays(today, -1)) return t('siteConditions.yesterday')
  try {
    return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short' })
  } catch {
    return date
  }
}

const round = (n) => (n == null ? '–' : Math.round(n))

function timeAgo(ms, t) {
  const mins = Math.round((Date.now() - ms) / 60000)
  if (mins < 1) return t('siteConditions.justNow')
  if (mins < 60) return t('siteConditions.minAgo', { count: mins })
  const h = Math.round(mins / 60)
  if (h < 48) return t('siteConditions.hAgo', { count: h })
  return t('siteConditions.daysAgo', { count: Math.round(h / 24) })
}

function SiteWeather({ site, today, isAdmin }) {
  const t = useT()
  const { showToast } = useToast()
  const refresh = useAction(api.weather.refreshSite)
  const [busy, setBusy] = useState(false)
  if (!site.hasCoordinates) {
    return (
      <p className="text-sm text-muted">
        {t('siteConditions.noCoordinates', { site: site.name })}{' '}
        <Link href="/farm-locations" className="rounded-sm text-text underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan">
          {t('siteConditions.farmLocations')}
        </Link>
      </p>
    )
  }
  const onRefresh = async () => {
    setBusy(true)
    try {
      await refresh({ locationId: site.id })
      showToast('success', t('siteConditions.updated'))
    } catch (err) {
      showToast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[14px] font-medium leading-[18px] text-text">{site.name}</p>
        {isAdmin && (
          <GhostButton size="sm" disabled={busy} onClick={onRefresh}>
            {busy ? t('siteConditions.updating') : t('siteConditions.refresh')}
          </GhostButton>
        )}
      </div>
      {site.days.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{t('siteConditions.noWeather')}</p>
      ) : (
        <ul className="mt-3 grid grid-cols-2 gap-[10px] sm:grid-cols-4">
          {site.days.map((d) => (
            <li key={d.date} className="flex flex-col gap-1 rounded-input border border-line bg-bg px-4 py-3">
              <p className="text-xs leading-4 text-faint">{dayName(d.date, today, t)}</p>
              <p className="text-[17px] font-semibold leading-[22px] text-text tabular-nums">
                {round(d.tempMaxC)}° <span className="font-normal text-muted">/ {round(d.tempMinC)}°</span>
              </p>
              <p className="text-xs leading-4 text-muted">
                {d.label || '—'}
                {d.precipitationMm ? ` · ${d.precipitationMm.toFixed(1)} mm` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Weather per site and latest sensor readings (INT-006, INT-007). */
export default function SiteConditions({ locationId, isAdmin }) {
  const t = useT()
  const today = useMemo(() => localToday(), [])
  const fromDate = addDays(today, -1)
  const args = locationId ? { locationId, fromDate } : { fromDate }
  const weather = useQuery(api.weather.forSites, args)
  const sensors = useQuery(api.sensors.latest, locationId ? { locationId } : {})

  if (!weather) return null
  const readings = sensors?.readings || []
  if (!weather.sites.length && !readings.length) return null

  return (
    <Card>
      <h2 className="text-base font-semibold leading-5 text-text">{t('siteConditions.title')}</h2>
      <p className="mb-5 mt-1 text-xs leading-4 text-muted">{t('siteConditions.subtitle')}</p>
      <div className="flex flex-col gap-6">
        {weather.sites.map((site) => (
          <SiteWeather key={site.id} site={site} today={today} isAdmin={isAdmin} />
        ))}
        {readings.length > 0 && (
          <div>
            <p className="text-[14px] font-medium leading-[18px] text-text">{t('siteConditions.sensors')}</p>
            <ul className="mt-1">
              {readings.map((r) => (
                <li key={r.id} className="flex items-center gap-[14px] border-t border-line py-[11px] first:border-t-0">
                  <div className="flex min-w-0 grow basis-0 flex-col gap-[2px]">
                    <p className="text-[14px] leading-[18px] text-text">{r.label}</p>
                    <p className="text-xs leading-4 text-muted">{r.source} · {timeAgo(r.measuredAt, t)}</p>
                  </div>
                  <p className="text-[14px] font-medium leading-[18px] text-text tabular-nums">
                    {r.value} {r.unit}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  )
}
