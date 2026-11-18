import { useState } from 'react'
import { useMutation } from 'convex/react'
import Link from 'next/link'
import { api } from '../convex/_generated/api'
import { useToast } from './Toast'
import { Button, Field, Select } from './ui'
import { errorMessage } from '../lib/errorMessage'

const num = (v, unit = '', dp = 1) =>
  v == null || v === ''
    ? null
    : `${Number(v).toLocaleString(undefined, { maximumFractionDigits: dp })}${unit}`

/** Rows shown in the profile, by unit type (CAGE-001, POND-001, RAS-001). */
const PROFILE_ROWS = {
  cage: [
    ['netVolumeM3', 'Net volume', ' m³'],
    ['volumeM3', 'Volume', ' m³'],
    ['diameterM', 'Diameter', ' m'],
    ['depthM', 'Net depth', ' m'],
    ['meshSizeMm', 'Mesh size', ' mm'],
  ],
  pond: [
    ['areaM2', 'Surface area', ' m²'],
    ['depthM', 'Average depth', ' m'],
    ['lengthM', 'Length', ' m'],
    ['widthM', 'Width', ' m'],
  ],
  tank: [
    ['volumeM3', 'Water volume', ' m³'],
    ['diameterM', 'Diameter', ' m'],
    ['depthM', 'Water depth', ' m'],
    ['flowM3h', 'Flow', ' m³/h'],
  ],
  raceway: [
    ['volumeM3', 'Water volume', ' m³'],
    ['lengthM', 'Length', ' m'],
    ['widthM', 'Width', ' m'],
    ['depthM', 'Water depth', ' m'],
    ['flowM3h', 'Flow', ' m³/h'],
  ],
}

function profileRows(unit, type) {
  const rows = (PROFILE_ROWS[type] || PROFILE_ROWS.tank)
    .map(([key, label, unitSuffix]) => [label, num(unit[key], unitSuffix)])
    .filter(([, v]) => v != null)
  if (type === 'pond' && unit.areaM2 && unit.depthM) {
    rows.push(['Water volume (est.)', num(unit.areaM2 * unit.depthM, ' m³', 0)])
  }
  if ((type === 'tank' || type === 'raceway') && unit.flowM3h && unit.volumeM3) {
    rows.push(['Water exchange', num(unit.flowM3h / unit.volumeM3, ' /h', 2)])
  }
  if (type === 'pond' && unit.waterSource) rows.push(['Water source', unit.waterSource])
  if (unit.capacity) rows.push(['Fish capacity', num(unit.capacity, ' fish', 0)])
  if (unit.material) rows.push(['Material', unit.material])
  return rows
}

const LEVEL_TONE = {
  ok: 'bg-kelp',
  warn: 'bg-amber-500',
  over: 'bg-signal',
  unknown: 'bg-foam-deep',
}

const LEVEL_TEXT = {
  ok: 'Within the limit',
  warn: 'Close to the limit',
  over: 'Over the limit',
  unknown: '',
}

/** Stocking density against the unit's limit (farm rule or the unit's own). */
export function DensityMeter({ density, noun = 'unit', densityNote }) {
  if (!density) return null
  if (density.density == null) {
    return (
      <p className="text-sm text-muted">
        Add the {density.measure === 'area' ? 'surface area' : density.sizeLabel} to see
        stocking density for this {noun.toLowerCase()}.
      </p>
    )
  }
  const pct = Math.max(0, Math.min(100, density.pctOfMax ?? 0))
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="text-chart-ink tabular-nums font-medium">
          {num(density.density, ` ${density.unit}`, 2)}
        </span>
        <span className="text-muted tabular-nums">
          {density.max ? `limit ${num(density.max, ` ${density.unit}`)}` : 'no limit set'}
        </span>
      </div>
      <div
        className="mt-1.5 h-2 rounded-full overflow-hidden bg-foam-deep"
        role="meter"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Stocking density as a share of the limit"
      >
        <div className={`h-full rounded-full ${LEVEL_TONE[density.level]}`} style={{ width: `${pct}%` }} />
      </div>
      <p className={`mt-1.5 text-xs ${density.level === 'over' ? 'text-signal' : 'text-muted'}`}>
        {LEVEL_TEXT[density.level]}
        {density.pctOfMax != null ? ` (${density.pctOfMax}% of limit)` : ''}
        {densityNote ? ` · measured ${densityNote}` : ''}
      </p>
    </div>
  )
}

/** Admin control for moving a unit through the status machine. */
function StatusControl({ ws }) {
  const { showToast } = useToast()
  const setStatus = useMutation(api.units.setStatus)
  const [target, setTarget] = useState('')
  const [saving, setSaving] = useState(false)
  const options = ws.nextStatuses || []
  if (!options.length) return null
  const chosen = options.find((o) => o.status === target)

  const save = async () => {
    if (!chosen?.allowed) return
    setSaving(true)
    try {
      await setStatus({ id: ws.unit._id, status: target })
      showToast(`Status set to ${chosen.label.toLowerCase()}`, 'success')
      setTarget('')
    } catch (err) {
      showToast(errorMessage(err, 'Could not change the status'), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
    <div className="flex flex-col sm:flex-row sm:items-end gap-2">
      <Field label="Change status" htmlFor="unit-status" className="flex-1">
        <Select id="unit-status" value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Choose…</option>
          {options.map((o) => (
            <option key={o.status} value={o.status} disabled={!o.allowed}>
              {o.label}
              {o.allowed ? '' : ' (not now)'}
            </option>
          ))}
        </Select>
      </Field>
      <Button size="sm" onClick={save} disabled={!chosen?.allowed || saving}>
        {saving ? 'Saving…' : 'Set status'}
      </Button>
    </div>
      {chosen && !chosen.allowed && <p className="mt-1.5 text-xs text-signal">{chosen.reason}</p>}
    </div>
  )
}

/** Type-specific profile card for the unit workspace. */
export default function UnitProfile({ ws, isAdmin }) {
  if (!ws) return null
  const { unit, profile, unitType } = ws
  const rows = profileRows(unit, unitType)
  return (
    <section className="page-card p-5 sm:p-6 space-y-5" aria-labelledby="unit-profile-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="unit-profile-title" className="font-display text-lg font-medium">
          {profile.noun} profile
        </h2>
        <p className="text-sm text-muted">
          {ws.status.label}
          {ws.status.changedAt
            ? ` since ${new Date(ws.status.changedAt).toLocaleDateString()}`
            : ''}
        </p>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4 text-sm">
        <div>
          <dt className="text-muted">Site</dt>
          <dd className="mt-0.5 text-chart-ink">{ws.site?.name || unit.location || '—'}</dd>
        </div>
        <div>
          <dt className="text-muted">{profile.groupNoun}</dt>
          <dd className="mt-0.5 text-chart-ink">
            {ws.group ? (
              <Link href={`/units?group=${ws.group._id}`} className="text-lake hover:underline">
                {ws.group.name}
              </Link>
            ) : (
              unit.unitGroup || '—'
            )}
          </dd>
        </div>
        {(unitType === 'cage' || ws.waterBody) && (
          <div>
            <dt className="text-muted">Water body</dt>
            <dd className="mt-0.5 text-chart-ink">{ws.waterBody?.name || '—'}</dd>
          </div>
        )}
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted">{label}</dt>
            <dd className="mt-0.5 text-chart-ink tabular-nums">{value}</dd>
          </div>
        ))}
        {unit.latitude != null && unit.longitude != null && (
          <div>
            <dt className="text-muted">Position</dt>
            <dd className="mt-0.5 tabular-nums">
              <a
                className="text-lake hover:underline"
                href={`https://www.openstreetmap.org/?mlat=${unit.latitude}&mlon=${unit.longitude}#map=17/${unit.latitude}/${unit.longitude}`}
                target="_blank"
                rel="noreferrer"
              >
                {Number(unit.latitude).toFixed(5)}, {Number(unit.longitude).toFixed(5)}
              </a>
            </dd>
          </div>
        )}
      </dl>

      <div>
        <h3 className="text-sm font-semibold text-chart-ink mb-2">Stocking density</h3>
        <DensityMeter density={ws.density} noun={profile.noun} densityNote={profile.densityNote} />
      </div>

      {isAdmin && !ws.archived && <StatusControl ws={ws} />}
      {ws.archived && (
        <p className="text-sm text-signal">This unit is archived. Restore it from the unit list to use it again.</p>
      )}
    </section>
  )
}
