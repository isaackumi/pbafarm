import { useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { Field, Input, Select } from './ui'
import { UNIT_TYPES } from '../lib/format'

/** Geometry fields that matter for each unit type (FARM-002). Metres throughout. */
export const FIELDS_BY_TYPE = {
  cage: ['netVolumeM3', 'volumeM3', 'diameterM', 'depthM', 'meshSizeMm'],
  pond: ['areaM2', 'depthM', 'lengthM', 'widthM'],
  tank: ['volumeM3', 'diameterM', 'depthM', 'flowM3h'],
  raceway: ['volumeM3', 'lengthM', 'widthM', 'depthM', 'flowM3h'],
  hatchery_tank: ['volumeM3', 'diameterM', 'flowM3h'],
  incubator: ['volumeM3', 'flowM3h'],
  hapa: ['areaM2', 'depthM', 'meshSizeMm'],
}

export const LABELS = {
  areaM2: ['Surface area (m²)', 'Stocking density for ponds is per m² of surface.'],
  volumeM3: ['Volume (m³)', 'Used for stocking density.'],
  netVolumeM3: ['Net volume (m³)', 'Water inside the net; cage density uses this first.'],
  depthM: ['Depth (m)', null],
  diameterM: ['Diameter (m)', null],
  lengthM: ['Length (m)', null],
  widthM: ['Width (m)', null],
  meshSizeMm: ['Mesh size (mm)', null],
  flowM3h: ['Water flow (m³/h)', null],
  maxDensity: ['Density limit (optional)', 'Overrides the farm rule for this unit.'],
}

export const EMPTY_GEOMETRY = {
  unitType: 'cage',
  areaM2: '',
  depthM: '',
  volumeM3: '',
  diameterM: '',
  netVolumeM3: '',
  meshSizeMm: '',
  lengthM: '',
  widthM: '',
  flowM3h: '',
  maxDensity: '',
  waterSource: '',
  latitude: '',
  longitude: '',
  unitGroup: '',
  unitGroupId: '',
}

export function geometryFromUnit(unit) {
  if (!unit) return { ...EMPTY_GEOMETRY }
  return {
    unitType: unit.unitType || unit.unit_type || 'cage',
    areaM2: unit.areaM2 ?? '',
    depthM: unit.depthM ?? '',
    volumeM3: unit.volumeM3 ?? unit.size ?? '',
    diameterM: unit.diameterM ?? '',
    netVolumeM3: unit.netVolumeM3 ?? '',
    meshSizeMm: unit.meshSizeMm ?? '',
    lengthM: unit.lengthM ?? '',
    widthM: unit.widthM ?? '',
    flowM3h: unit.flowM3h ?? '',
    maxDensity: unit.maxDensity ?? '',
    waterSource: unit.waterSource || '',
    latitude: unit.latitude ?? '',
    longitude: unit.longitude ?? '',
    unitGroup: unit.unitGroup || '',
    unitGroupId: unit.unitGroupId || '',
  }
}

/** Mutation args from the form: numbers for the fields this type uses. */
export function geometryArgs(form) {
  const out = { unitType: form.unitType || 'cage' }
  for (const key of [...(FIELDS_BY_TYPE[out.unitType] || []), 'maxDensity']) {
    const raw = form[key]
    if (raw === '' || raw == null) continue
    const n = Number(raw)
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`${LABELS[key][0]} must be a positive number`)
    }
    out[key] = n
  }
  if (out.volumeM3 !== undefined) out.size = out.volumeM3
  if (typeof form.unitGroup === 'string' && form.unitGroup.trim()) {
    out.unitGroup = form.unitGroup.trim()
  }
  if (form.unitGroupId) out.unitGroupId = form.unitGroupId
  if (out.unitType === 'pond' && typeof form.waterSource === 'string' && form.waterSource.trim()) {
    out.waterSource = form.waterSource.trim()
  }
  const lat = form.latitude === '' || form.latitude == null ? null : Number(form.latitude)
  const lng = form.longitude === '' || form.longitude == null ? null : Number(form.longitude)
  if ((lat === null) !== (lng === null)) throw new Error('Give both latitude and longitude, or neither')
  if (lat !== null) {
    if (!Number.isFinite(lat) || Math.abs(lat) > 90) throw new Error('Latitude must be between -90 and 90')
    if (!Number.isFinite(lng) || Math.abs(lng) > 180) throw new Error('Longitude must be between -180 and 180')
    out.latitude = lat
    out.longitude = lng
  }
  return out
}

function NumberField({ k, value, onChange, idPrefix }) {
  return (
    <Field label={LABELS[k][0]} htmlFor={`${idPrefix}-${k}`} hint={LABELS[k][1] || undefined}>
      <Input
        id={`${idPrefix}-${k}`}
        type="number"
        step="any"
        min="0"
        inputMode="decimal"
        className="font-data tabular-nums"
        value={value[k]}
        onChange={(e) => onChange(k, e.target.value)}
      />
    </Field>
  )
}

/**
 * Unit type selector plus the geometry that type needs. `value` is a
 * geometry form (see EMPTY_GEOMETRY); `onChange(key, value)` patches it.
 */
export default function UnitGeometryFields({ value, onChange, idPrefix = 'unit' }) {
  const type = value.unitType || 'cage'
  const fields = FIELDS_BY_TYPE[type] || []
  const groups = useQuery(api.units.listGroups, {})
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Unit type" htmlFor={`${idPrefix}-type`}>
        <Select
          id={`${idPrefix}-type`}
          value={type}
          onChange={(e) => onChange('unitType', e.target.value)}
        >
          {UNIT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>
      {groups && groups.length > 0 ? (
        <Field label="Group" htmlFor={`${idPrefix}-groupId`} hint="Cage group, pond block or RAS system">
          <Select
            id={`${idPrefix}-groupId`}
            value={value.unitGroupId || ''}
            onChange={(e) => {
              const g = groups.find((x) => x._id === e.target.value)
              onChange('unitGroupId', e.target.value)
              onChange('unitGroup', g ? g.name : '')
            }}
          >
            <option value="">Not in a group</option>
            {groups.map((g) => (
              <option key={g._id} value={g._id}>
                {g.name}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <Field label="Group" htmlFor={`${idPrefix}-group`} hint="Optional, e.g. Block A or Line 2">
          <Input
            id={`${idPrefix}-group`}
            value={value.unitGroup}
            onChange={(e) => onChange('unitGroup', e.target.value)}
          />
        </Field>
      )}
      {fields.map((key) => (
        <NumberField key={key} k={key} value={value} onChange={onChange} idPrefix={idPrefix} />
      ))}
      <NumberField k="maxDensity" value={value} onChange={onChange} idPrefix={idPrefix} />
      {type === 'pond' && (
        <Field label="Water source" htmlFor={`${idPrefix}-waterSource`} hint="Borehole, river, canal, rain…">
          <Input
            id={`${idPrefix}-waterSource`}
            value={value.waterSource}
            onChange={(e) => onChange('waterSource', e.target.value)}
          />
        </Field>
      )}
      <Field label="Latitude" htmlFor={`${idPrefix}-lat`} hint="Decimal degrees, e.g. 6.2934">
        <Input
          id={`${idPrefix}-lat`}
          type="number"
          step="any"
          inputMode="decimal"
          className="font-data tabular-nums"
          value={value.latitude}
          onChange={(e) => onChange('latitude', e.target.value)}
        />
      </Field>
      <Field label="Longitude" htmlFor={`${idPrefix}-lng`} hint="Decimal degrees, e.g. 0.0571">
        <Input
          id={`${idPrefix}-lng`}
          type="number"
          step="any"
          inputMode="decimal"
          className="font-data tabular-nums"
          value={value.longitude}
          onChange={(e) => onChange('longitude', e.target.value)}
        />
      </Field>
    </div>
  )
}
