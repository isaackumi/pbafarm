import { Field, Input, Select } from './ui'
import { UNIT_TYPES } from '../lib/format'

/** Geometry fields that matter for each unit type (FARM-002). Metres throughout. */
const FIELDS_BY_TYPE = {
  cage: ['volumeM3', 'diameterM', 'depthM'],
  pond: ['areaM2', 'depthM'],
  tank: ['volumeM3', 'diameterM', 'depthM'],
  raceway: ['volumeM3', 'depthM'],
  hatchery_tank: ['volumeM3', 'diameterM'],
  incubator: ['volumeM3'],
  hapa: ['areaM2', 'depthM'],
}

const LABELS = {
  areaM2: ['Surface area (m²)', 'Stocking density for ponds is per m² of surface.'],
  volumeM3: ['Volume (m³)', 'Used for stocking density.'],
  depthM: ['Depth (m)', null],
  diameterM: ['Diameter (m)', null],
}

export const EMPTY_GEOMETRY = {
  unitType: 'cage',
  areaM2: '',
  depthM: '',
  volumeM3: '',
  diameterM: '',
  unitGroup: '',
}

export function geometryFromUnit(unit) {
  if (!unit) return { ...EMPTY_GEOMETRY }
  return {
    unitType: unit.unitType || unit.unit_type || 'cage',
    areaM2: unit.areaM2 ?? '',
    depthM: unit.depthM ?? '',
    volumeM3: unit.volumeM3 ?? unit.size ?? '',
    diameterM: unit.diameterM ?? '',
    unitGroup: unit.unitGroup || '',
  }
}

/** Mutation args from the form: numbers for the fields this type uses. */
export function geometryArgs(form) {
  const out = { unitType: form.unitType || 'cage' }
  for (const key of FIELDS_BY_TYPE[out.unitType] || []) {
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
  return out
}

/**
 * Unit type selector plus the geometry that type needs. `value` is a
 * geometry form (see EMPTY_GEOMETRY); `onChange(key, value)` patches it.
 */
export default function UnitGeometryFields({ value, onChange, idPrefix = 'unit' }) {
  const type = value.unitType || 'cage'
  const fields = FIELDS_BY_TYPE[type] || []
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
      <Field label="Group" htmlFor={`${idPrefix}-group`} hint="Optional, e.g. Block A or Line 2">
        <Input
          id={`${idPrefix}-group`}
          value={value.unitGroup}
          onChange={(e) => onChange('unitGroup', e.target.value)}
        />
      </Field>
      {fields.map((key) => (
        <Field key={key} label={LABELS[key][0]} htmlFor={`${idPrefix}-${key}`} hint={LABELS[key][1] || undefined}>
          <Input
            id={`${idPrefix}-${key}`}
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            className="font-data tabular-nums"
            value={value[key]}
            onChange={(e) => onChange(key, e.target.value)}
          />
        </Field>
      ))}
    </div>
  )
}
