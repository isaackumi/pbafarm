import { MapPin, Lock } from 'lucide-react'
import { useLocation } from '../contexts/LocationContext'

/**
 * Locked location metadata for create forms.
 * Always tracks the header farm location — change site from the header switcher.
 */
export default function LocationMetaField({
  className = '',
  label = 'Farm location',
  hint = 'Locked to the location selected in the header. Switch there to change site.',
}) {
  const { activeLocation, activeLocationId, loading } = useLocation()

  return (
    <div className={className}>
      <label className="mb-1 block text-sm font-medium text-chart-ink">
        {label}
      </label>
      <div className="flex min-h-10 items-center gap-2 rounded-xl border border-input-border bg-foam-deep/30 px-3 py-2 text-sm text-chart-ink">
        <MapPin className="h-4 w-4 shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium">
          {loading
            ? 'Loading…'
            : activeLocation?.name ||
              (activeLocationId ? 'Selected location' : 'No location set')}
        </span>
        <span className="inline-flex items-center gap-1 rounded-md bg-surface px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted">
          <Lock className="h-3 w-3" aria-hidden />
          Locked
        </span>
      </div>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      {activeLocationId ? (
        <input type="hidden" name="locationId" value={activeLocationId} readOnly />
      ) : null}
    </div>
  )
}
