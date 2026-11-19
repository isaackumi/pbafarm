import { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { ArrowDown, ArrowUp, Plus } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import { EmptyState, GhostButton, GradientButton } from '../ui'
import { useToast } from '../Toast'
import { errorMessage } from '../../lib/errorMessage'
import {
  CUSTOM_ENTITIES,
  CUSTOM_ENTITY_LABELS,
  CUSTOM_FIELD_TYPES,
  CUSTOM_FIELD_TYPE_LABELS,
} from '../../convex/lib/customFieldRules'
import CustomFields from '../CustomFields'
import { FIELD, SettingsCard, SettingsField } from '../settings'

/** Built-in fields a condition can look at, per entity ('core:<name>'). */
const CORE_FIELDS = {
  cages: [['unitType', 'Unit type'], ['status', 'Status']],
  farmLocations: [['siteType', 'Site type']],
  batches: [['origin', 'Origin'], ['species', 'Species'], ['status', 'Status']],
  dailyRecords: [['mortality', 'Mortality'], ['feedAmount', 'Feed (kg)'], ['mortalityCause', 'Mortality cause']],
  biweeklyRecords: [['totalFishCount', 'Fish counted'], ['totalWeight', 'Total weight']],
  harvestRecords: [['harvestType', 'Harvest type'], ['totalWeight', 'Total weight']],
  stockingHistory: [['species', 'Species'], ['fishCount', 'Fish count']],
  expenses: [['category', 'Category'], ['amount', 'Amount']],
  equipment: [['kind', 'Kind']],
}

const OPS = [
  ['eq', 'is'],
  ['neq', 'is not'],
  ['gt', 'is more than'],
  ['lt', 'is less than'],
  ['is_set', 'is filled in'],
  ['is_not_set', 'is empty'],
]

const keyFrom = (label) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/, '')
    .slice(0, 40)

const blank = () => ({
  id: null,
  label: '',
  key: '',
  keyTouched: false,
  type: 'text',
  unit: '',
  helpText: '',
  required: false,
  optionsText: '',
  min: '',
  max: '',
  integer: false,
  pattern: '',
  maxLength: '',
  defaultValue: '',
  condField: '',
  condOp: 'eq',
  condValue: '',
  locationIds: [],
})

function fromDef(d) {
  const c = d.conditions?.[0]
  return {
    ...blank(),
    id: d._id,
    label: d.label,
    key: d.key,
    keyTouched: true,
    type: d.type,
    unit: d.unit ?? '',
    helpText: d.helpText ?? '',
    required: d.required,
    optionsText: (d.options ?? [])
      .map((o) => `${o.label}${o.value !== keyFrom(o.label) ? ` = ${o.value}` : ''}${o.archived ? ' (archived)' : ''}`)
      .join('\n'),
    min: d.validation?.min ?? '',
    max: d.validation?.max ?? '',
    integer: Boolean(d.validation?.integer),
    pattern: d.validation?.pattern ?? '',
    maxLength: d.validation?.maxLength ?? '',
    defaultValue: Array.isArray(d.defaultValue) ? d.defaultValue.join(', ') : d.defaultValue ?? '',
    condField: c?.field ?? '',
    condOp: c?.op ?? 'eq',
    condValue: c?.value ?? '',
    locationIds: d.locationIds ?? [],
  }
}

/** One choice per line: "Label" or "Label = value"; "(archived)" keeps it for old records only. */
function parseOptions(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const archived = /\(archived\)\s*$/i.test(line)
      const clean = line.replace(/\(archived\)\s*$/i, '').trim()
      const [label, value] = clean.split('=').map((s) => s.trim())
      return { label, value: value || keyFrom(label) || label, ...(archived ? { archived: true } : {}) }
    })
}

function toArgs(entity, f) {
  const num = (v) => (v === '' || v == null ? undefined : Number(v))
  const choice = f.type === 'select' || f.type === 'multiselect'
  const validation = {}
  if (f.type === 'number') {
    if (num(f.min) !== undefined) validation.min = num(f.min)
    if (num(f.max) !== undefined) validation.max = num(f.max)
    if (f.integer) validation.integer = true
  }
  if (f.type === 'text' || f.type === 'long_text') {
    if (f.pattern.trim()) validation.pattern = f.pattern.trim()
    if (num(f.maxLength) !== undefined) validation.maxLength = num(f.maxLength)
  }
  let defaultValue
  if (f.defaultValue !== '' && f.type !== 'photo') {
    if (f.type === 'number') defaultValue = Number(f.defaultValue)
    else if (f.type === 'boolean') defaultValue = f.defaultValue === 'yes' || f.defaultValue === true
    else if (f.type === 'multiselect') defaultValue = String(f.defaultValue).split(',').map((s) => s.trim()).filter(Boolean)
    else defaultValue = String(f.defaultValue)
  }
  const conditions = f.condField
    ? [
        {
          field: f.condField,
          op: f.condOp,
          ...(['is_set', 'is_not_set'].includes(f.condOp)
            ? {}
            : { value: ['gt', 'lt'].includes(f.condOp) && f.condValue !== '' && !Number.isNaN(Number(f.condValue)) ? Number(f.condValue) : String(f.condValue) }),
        },
      ]
    : undefined
  return {
    ...(f.id ? { id: f.id } : {}),
    entity,
    key: f.key,
    label: f.label,
    type: f.type,
    required: f.required,
    ...(f.unit.trim() ? { unit: f.unit.trim() } : {}),
    ...(f.helpText.trim() ? { helpText: f.helpText.trim() } : {}),
    ...(choice ? { options: parseOptions(f.optionsText) } : {}),
    ...(Object.keys(validation).length ? { validation } : {}),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    ...(conditions ? { conditions } : {}),
    ...(f.locationIds.length ? { locationIds: f.locationIds } : {}),
  }
}

function FieldEditor({ entity, initial, defs, sites, onDone }) {
  const save = useMutation(api.customFields.save)
  const { showToast } = useToast()
  const [f, setF] = useState(initial)
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => {
    const v = e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e
    setF((p) => {
      const next = { ...p, [k]: v }
      if (k === 'label' && !p.keyTouched && !p.id) next.key = keyFrom(v)
      if (k === 'key') next.keyTouched = true
      return next
    })
  }
  const editing = Boolean(f.id)
  const choice = f.type === 'select' || f.type === 'multiselect'
  const others = defs.filter((d) => d._id !== f.id && !d.archived)

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await save(toArgs(entity, f))
      showToast('success', editing ? 'Field updated' : 'Field added')
      onDone()
    } catch (err) {
      showToast('error', errorMessage(err, 'Could not save the field'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SettingsField label="Label" htmlFor="cf-label" required>
          <input className={FIELD} id="cf-label" value={f.label} onChange={set('label')} placeholder="Net mesh size" maxLength={80} />
        </SettingsField>
        <SettingsField label="Key" htmlFor="cf-key" hint={editing ? 'Fixed once the field exists' : 'Used in exports and the API'}>
          <input id="cf-key" value={f.key} onChange={set('key')} disabled={editing} maxLength={40} className={`${FIELD} font-data`} />
        </SettingsField>
        <SettingsField label="Type" htmlFor="cf-type" hint={editing ? 'Fixed once the field exists' : undefined}>
          <select className={FIELD} id="cf-type" value={f.type} onChange={set('type')} disabled={editing}>
            {CUSTOM_FIELD_TYPES.map((t) => (
              <option key={t} value={t}>{CUSTOM_FIELD_TYPE_LABELS[t]}</option>
            ))}
          </select>
        </SettingsField>
        {f.type === 'number' && (
          <SettingsField label="Unit" htmlFor="cf-unit" hint="Shown next to the value, e.g. mm or kg">
            <input className={FIELD} id="cf-unit" value={f.unit} onChange={set('unit')} maxLength={20} />
          </SettingsField>
        )}
        <SettingsField label="Help text" htmlFor="cf-help" className="sm:col-span-2">
          <input className={FIELD} id="cf-help" value={f.helpText} onChange={set('helpText')} maxLength={300} />
        </SettingsField>
        {choice && (
          <SettingsField
            label="Choices"
            htmlFor="cf-options"
            className="sm:col-span-2"
            hint='One per line. Add "(archived)" to stop offering a choice while keeping it on old records.'
          >
            <textarea className={FIELD} id="cf-options" rows={4} value={f.optionsText} onChange={set('optionsText')} placeholder={'Good\nTorn\nNeeds repair'} />
          </SettingsField>
        )}
        {f.type === 'number' && (
          <>
            <SettingsField label="Minimum" htmlFor="cf-min">
              <input className={FIELD} id="cf-min" type="number" step="any" value={f.min} onChange={set('min')} />
            </SettingsField>
            <SettingsField label="Maximum" htmlFor="cf-max">
              <input className={FIELD} id="cf-max" type="number" step="any" value={f.max} onChange={set('max')} />
            </SettingsField>
            <label className="flex items-center gap-2 text-sm text-text min-h-12">
              <input type="checkbox" checked={f.integer} onChange={set('integer')} className="h-5 w-5 rounded border-line-strong" />
              Whole numbers only
            </label>
          </>
        )}
        {(f.type === 'text' || f.type === 'long_text') && (
          <>
            <SettingsField label="Format (pattern)" htmlFor="cf-pattern" hint="Optional regular expression the whole value must match">
              <input id="cf-pattern" value={f.pattern} onChange={set('pattern')} className={`${FIELD} font-data`} maxLength={200} />
            </SettingsField>
            <SettingsField label="Maximum length" htmlFor="cf-maxlen">
              <input className={FIELD} id="cf-maxlen" type="number" min="1" value={f.maxLength} onChange={set('maxLength')} />
            </SettingsField>
          </>
        )}
        {f.type !== 'photo' && (
          <SettingsField
            label="Default value"
            htmlFor="cf-default"
            hint={f.type === 'multiselect' ? 'Comma-separated choice values' : 'Filled in on new records'}
          >
            {f.type === 'boolean' ? (
              <select className={FIELD} id="cf-default" value={f.defaultValue === true ? 'yes' : f.defaultValue === false ? 'no' : f.defaultValue} onChange={set('defaultValue')}>
                <option value="">None</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            ) : f.type === 'select' ? (
              <select className={FIELD} id="cf-default" value={f.defaultValue} onChange={set('defaultValue')}>
                <option value="">None</option>
                {parseOptions(f.optionsText).filter((o) => !o.archived).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : (
              <input className={FIELD} id="cf-default" type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} step="any" value={f.defaultValue} onChange={set('defaultValue')} />
            )}
          </SettingsField>
        )}
        <label className="flex items-center gap-2 text-sm text-text min-h-12 sm:col-span-2">
          <input type="checkbox" checked={f.required} onChange={set('required')} className="h-5 w-5 rounded border-line-strong" />
          Required when shown (checked on the server for every form, import and API call that creates the record)
        </label>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-input border border-line p-4">
        <legend className="px-1 text-sm font-semibold text-text">Show only when</legend>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SettingsField label="Field" htmlFor="cf-cond-field">
            <select className={FIELD} id="cf-cond-field" value={f.condField} onChange={set('condField')}>
              <option value="">Always show</option>
              <optgroup label="Built-in">
                {(CORE_FIELDS[entity] || []).map(([k, l]) => (
                  <option key={k} value={`core:${k}`}>{l}</option>
                ))}
              </optgroup>
              {others.length > 0 && (
                <optgroup label="Custom">
                  {others.map((d) => (
                    <option key={d._id} value={`custom:${d.key}`}>{d.label}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </SettingsField>
          {f.condField && (
            <>
              <SettingsField label="Condition" htmlFor="cf-cond-op">
                <select className={FIELD} id="cf-cond-op" value={f.condOp} onChange={set('condOp')}>
                  {OPS.map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </SettingsField>
              {!['is_set', 'is_not_set'].includes(f.condOp) && (
                <SettingsField label="Value" htmlFor="cf-cond-value">
                  <input className={FIELD} id="cf-cond-value" value={f.condValue} onChange={set('condValue')} />
                </SettingsField>
              )}
            </>
          )}
        </div>
        {sites?.length > 1 && (
          <div>
            <p className="text-sm font-semibold text-text mb-2">Sites</p>
            <div className="flex flex-wrap gap-2">
              {sites.map((s) => {
                const id = s.id || s._id
                const on = f.locationIds.includes(id)
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setF((p) => ({ ...p, locationIds: on ? p.locationIds.filter((x) => x !== id) : [...p.locationIds, id] }))}
                    className={`min-h-10 rounded-pill border px-3 text-[13px] ${on ? 'border-lake bg-lake-soft text-text' : 'border-line text-muted hover:border-lake'}`}
                  >
                    {s.name}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-muted mt-2">None selected: every site.</p>
          </div>
        )}
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <GradientButton type="submit" disabled={saving || !f.label.trim() || !f.key}>
          {saving ? 'Saving…' : editing ? 'Save field' : 'Add field'}
        </GradientButton>
        <GhostButton onClick={onDone} disabled={saving}>Cancel</GhostButton>
      </div>
    </form>
  )
}

export default function FieldsBuilder() {
  const [entity, setEntity] = useState('cages')
  const defs = useQuery(api.customFields.defs, { entity, includeArchived: true })
  const sites = useQuery(api.farmLocations.list, {})
  const setArchived = useMutation(api.customFields.setArchived)
  const reorder = useMutation(api.customFields.reorder)
  const { showToast } = useToast()
  const [editing, setEditing] = useState(null)
  const [preview, setPreview] = useState({})

  const active = useMemo(() => (defs || []).filter((d) => !d.archived), [defs])
  const archived = useMemo(() => (defs || []).filter((d) => d.archived), [defs])

  const move = async (index, delta) => {
    const ids = active.map((d) => d._id)
    const j = index + delta
    if (j < 0 || j >= ids.length) return
    ;[ids[index], ids[j]] = [ids[j], ids[index]]
    try {
      await reorder({ entity, ids })
    } catch (err) {
      showToast('error', errorMessage(err, 'Could not reorder'))
    }
  }
  const toggle = async (d) => {
    try {
      await setArchived({ id: d._id, archived: !d.archived })
      showToast('success', d.archived ? 'Field restored' : 'Field archived. Values stay on records')
    } catch (err) {
      showToast('error', errorMessage(err, 'Could not change the field'))
    }
  }

  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-5 lg:col-span-2">
        <SettingsCard title="Custom fields" action={
              !editing && (
                <GradientButton size="sm" onClick={() => setEditing(blank())}>
                  <Plus className="h-4 w-4" aria-hidden />
                  Add field
                </GradientButton>
              )
            }>
          <p className="-mt-2 mb-2 text-[12px] leading-4 text-muted">Extra fields your team fills in on forms. Values are checked on the server and included in exports and the API.</p>
          <SettingsField label="Record type" htmlFor="cf-entity" className="max-w-xs mb-4">
            <select
              className={FIELD}
              id="cf-entity"
              value={entity}
              onChange={(e) => {
                setEntity(e.target.value)
                setEditing(null)
                setPreview({})
              }}
            >
              {CUSTOM_ENTITIES.map((e) => (
                <option key={e} value={e}>{CUSTOM_ENTITY_LABELS[e]}</option>
              ))}
            </select>
          </SettingsField>

          {editing ? (
            <FieldEditor
              key={editing.id || 'new'}
              entity={entity}
              initial={editing}
              defs={defs || []}
              sites={sites || []}
              onDone={() => setEditing(null)}
            />
          ) : defs === undefined ? (
            <p className="text-[13px] leading-4 text-muted">Loading…</p>
          ) : active.length === 0 ? (
            <EmptyState
              title={`No custom fields on ${CUSTOM_ENTITY_LABELS[entity].toLowerCase()}`}
              description="Add one when your team needs to record something the built-in form does not ask for."
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {active.map((d, i) => (
                <li
                  key={d._id}
                  className="flex flex-wrap items-center gap-3 rounded-input border border-line px-4 py-[14px]"
                  style={{ backgroundColor: 'color-mix(in oklab, var(--bg) 70%, var(--surface-2))' }}
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                    <p className="truncate text-[14px] leading-[18px] text-text">
                      {d.label}
                      {d.required && <span className="text-alert ml-0.5">*</span>}
                    </p>
                    <p className="truncate text-[12px] leading-4 text-muted">
                      {CUSTOM_FIELD_TYPE_LABELS[d.type]}
                      {d.unit ? ` · ${d.unit}` : ''}
                      {d.conditions?.length ? ' · conditional' : ''}
                      {d.locationIds?.length ? ` · ${d.locationIds.length} site(s)` : ''}
                      <span className="font-data"> · {d.key}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <GhostButton size="sm" aria-label={`Move ${d.label} up`} onClick={() => move(i, -1)} disabled={i === 0}>
                      <ArrowUp className="h-4 w-4" aria-hidden />
                    </GhostButton>
                    <GhostButton size="sm" aria-label={`Move ${d.label} down`} onClick={() => move(i, 1)} disabled={i === active.length - 1}>
                      <ArrowDown className="h-4 w-4" aria-hidden />
                    </GhostButton>
                    <GhostButton onClick={() => setEditing(fromDef(d))}>Edit</GhostButton>
                    <GhostButton size="sm" onClick={() => toggle(d)}>Archive</GhostButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SettingsCard>

        {archived.length > 0 && !editing && (
          <SettingsCard title="Archived">
            <p className="-mt-2 mb-2 text-[12px] leading-4 text-muted">Not shown on forms. Values already recorded stay on records and in exports.</p>
            <ul>
              {archived.map((d) => (
                <li key={d._id} className="flex items-center justify-between gap-3 border-t border-line py-3">
                  <span className="truncate text-[14px] leading-[18px] text-muted">
                    {d.label} <span className="font-data">· {d.key}</span>
                  </span>
                  <GhostButton size="sm" onClick={() => toggle(d)}>Restore</GhostButton>
                </li>
              ))}
            </ul>
          </SettingsCard>
        )}
      </div>

      <SettingsCard title="Preview">
        <p className="-mt-2 mb-2 text-[12px] leading-4 text-muted">How the fields look on a form. Try the conditions.</p>
        {active.length ? (
          <CustomFields entity={entity} value={preview} onChange={setPreview} columns={1} idPrefix="cf-preview" />
        ) : (
          <p className="text-[13px] leading-4 text-muted">Nothing to preview yet.</p>
        )}
      </SettingsCard>
    </div>
  )
}
