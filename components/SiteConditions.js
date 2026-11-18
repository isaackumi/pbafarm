import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useAction, useQuery } from 'convex/react'
import { CloudSun } from 'lucide-react'
import { api } from '../convex/_generated/api'
import { Button, Card, CardHeader } from './ui'
import { useToast } from './Toast'
import { errorMessage } from '../lib/errorMessage'
import { addDays, localToday } from '../lib/format'

function dayName(date, today) {
  if (date === today) return 'Today'
  if (date === addDays(today, 1)) return 'Tomorrow'
  if (date === addDays(today, -1)) return 'Yesterday'
  try {
    return new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short' })
  } catch {
    return date
  }
}

const round = (n) => (n == null ? '–' : Math.round(n))

function timeAgo(ms) {
  const mins = Math.round((Date.now() - ms) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

function SiteWeather({ site, today, isAdmin }) {
  const { showToast } = useToast()
  const refresh = useAction(api.weather.refreshSite)
  const [busy, setBusy] = useState(false)
  if (!site.hasCoordinates) {
    return (
      <p className="text-sm text-muted">
        {site.name}: add latitude and longitude under{' '}
        <Link href="/farm-locations" className="text-lake underline">Farm locations</Link> to see weather.
      </p>
    )
  }
  const onRefresh = async () => {
    setBusy(true)
    try {
      await refresh({ locationId: site.id })
      showToast('success', 'Weather updated')
    } catch (err) {
      showToast('error', errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-chart-ink">{site.name}</p>
        {isAdmin && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onRefresh}>
            {busy ? 'Updating…' : 'Refresh'}
          </Button>
        )}
      </div>
      {site.days.length === 0 ? (
        <p className="text-sm text-muted">No weather yet. It is fetched every morning.</p>
      ) : (
        <ul className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {site.days.map((d) => (
            <li key={d.date} className="rounded-lg border border-foam-deep px-3 py-2">
              <p className="text-xs text-muted">{dayName(d.date, today)}</p>
              <p className="text-base font-medium text-chart-ink tabular-nums">
                {round(d.tempMaxC)}° <span className="text-muted">/ {round(d.tempMinC)}°</span>
              </p>
              <p className="text-xs text-muted">
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
      <CardHeader
        title="Site conditions"
        subtitle="Weather from Open-Meteo, and the latest sensor readings"
        action={<CloudSun size={20} className="text-muted" aria-hidden />}
      />
      <div className="space-y-5">
        {weather.sites.map((site) => (
          <SiteWeather key={site.id} site={site} today={today} isAdmin={isAdmin} />
        ))}
        {readings.length > 0 && (
          <div>
            <p className="text-sm font-medium text-chart-ink">Sensors</p>
            <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {readings.map((r) => (
                <li key={r.id} className="rounded-lg border border-foam-deep px-3 py-2 text-sm">
                  <p className="text-xs text-muted">{r.source} · {r.label}</p>
                  <p className="font-medium text-chart-ink tabular-nums">
                    {r.value} {r.unit}
                    <span className="ml-2 text-xs font-normal text-muted">{timeAgo(r.measuredAt)}</span>
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
