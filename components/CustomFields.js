import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { Camera } from 'lucide-react'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { Button, Card, CardHeader, Field, Input, Select, Textarea } from './ui'
import { errorMessage } from '../lib/errorMessage'
import { usePermission } from '../hooks/usePermission'
import { convexSiteUrl } from '../lib/apiBase'
import {
  defaultValues,
  formatValue,
  isEmpty,
  visibleDefs,
} from '../convex/lib/customFieldRules'
import { sha256HexOfFile } from '../lib/fileHash'

/**
 * Custom fields (D-007, CUSTOM-001): one renderer for every entity's forms and
 * detail pages. Definitions come from Settings → Customization; the server
 * validates the same rules (convex/lib/customFields).
 */

/** Active definitions of an entity (undefined while loading). */
export function useCustomFieldDefs(entity, { includeArchived = false } = {}) {
  const { canUseApp } = useAuth()
  return useQuery(api.customFields.defs, canUseApp && entity ? { entity, includeArchived } : 'skip')
}

/**
 * Start a new record's values with the defaults once definitions load.
 * Returns the defaults (stable) so a form can seed its state.
 */
export function useCustomDefaults(entity, locationId) {
  const defs = useCustomFieldDefs(entity)
  return useMemo(
    () => (defs ? defaultValues(defs, { locationId: locationId || null }) : {}),
    [defs, locationId],
  )
}

/** Strip empty values before sending; undefined when nothing is set. */
export function customPayload(values) {
  if (!values) return undefined
  const out = {}
  for (const [k, v] of Object.entries(values)) if (!isEmpty(v)) out[k] = v
  return Object.keys(out).length ? out : undefined
}

function PhotoInput({ def, value, onChange, id }) {
  const generateUploadUrl = useMutation(api.files.generateUploadUrl)
  const attach = useMutation(api.files.attach)
  const requestDownload = useMutation(api.files.requestDownload)
  const { showToast } = useToast()
  const input = useRef(null)
  const [busy, setBusy] = useState(false)

  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 10 * 1024 * 1024) return showToast('error', 'Photos can be at most 10 MB')
    setBusy(true)
    try {
      const { uploadUrl, uploadId } = await generateUploadUrl({
        entityType: 'customFieldDefs',
        entityId: def._id,
        sha256: await sha256HexOfFile(file),
      })
      const res = await fetch(uploadUrl, { method: 'POST', headers: { 'Content-Type': file.type || 'image/jpeg' }, body: file })
      if (!res.ok) throw new Error('Upload failed. Try again.')
      const { storageId } = await res.json()
      const out = await attach({ entityType: 'customFieldDefs', entityId: def._id, uploadId, storageId, name: file.name })
      if (!out.ok) throw new Error(out.message)
      onChange(out.id)
    } catch (err) {
      showToast('error', errorMessage(err, 'Could not upload the photo'))
    } finally {
      setBusy(false)
    }
  }
  const view = async () => {
    try {
      const { path } = await requestDownload({ fileId: value })
      window.open(`${convexSiteUrl()}${path}`, '_blank', 'noopener')
    } catch (err) {
      showToast('error', errorMessage(err, 'Could not open the photo'))
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input ref={input} id={id} type="file" accept="image/*" capture="environment" className="sr-only" onChange={pick} />
      <Button variant="secondary" size="sm" onClick={() => input.current?.click()} disabled={busy}>
        <Camera className="h-4 w-4" aria-hidden />
        {busy ? 'Uploading…' : value ? 'Replace photo' : 'Add photo'}
      </Button>
      {value && (
        <>
          <Button variant="ghost" size="sm" onClick={view}>View</Button>
          <Button variant="ghost" size="sm" onClick={() => onChange(null)}>Remove</Button>
        </>
      )}
    </div>
  )
}

function FieldInput({ def, value, onChange, id, error }) {
  const common = { id, 'aria-invalid': error ? true : undefined }
  switch (def.type) {
    case 'long_text':
      return <Textarea {...common} value={value ?? ''} maxLength={def.validation?.maxLength ?? 2000} onChange={(e) => onChange(e.target.value)} />
    case 'number':
      return (
        <div className="flex items-center gap-2">
          <Input
            {...common}
            type="number"
            inputMode="decimal"
            step={def.validation?.integer ? 1 : 'any'}
            min={def.validation?.min}
            max={def.validation?.max}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          />
          {def.unit && <span className="text-sm text-muted shrink-0">{def.unit}</span>}
        </div>
      )
    case 'date':
      return <Input {...common} type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} />
    case 'boolean':
      return (
        <Select {...common} value={value === true ? 'yes' : value === false ? 'no' : ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value === 'yes')}>
          <option value="">Not set</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </Select>
      )
    case 'select':
      return (
        <Select {...common} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Choose…</option>
          {(def.options ?? [])
            .filter((o) => !o.archived || o.value === value)
            .map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
        </Select>
      )
    case 'multiselect': {
      const set = new Set(Array.isArray(value) ? value : [])
      return (
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${id}-label`}>
          {(def.options ?? [])
            .filter((o) => !o.archived || set.has(o.value))
            .map((o) => {
              const on = set.has(o.value)
              return (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const next = new Set(set)
                    if (on) next.delete(o.value)
                    else next.add(o.value)
                    onChange([...next])
                  }}
                  className={`min-h-10 rounded-lg border px-3 text-sm transition-colors ${
                    on ? 'border-lake bg-lake-soft text-chart-ink' : 'border-foam-deep text-muted hover:border-lake'
                  }`}
                >
                  {o.label}
                </button>
              )
            })}
        </div>
      )
    }
    case 'photo':
      return <PhotoInput def={def} value={value} onChange={onChange} id={id} />
    default:
      return (
        <Input
          {...common}
          value={value ?? ''}
          maxLength={def.validation?.maxLength ?? 200}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}

/** One custom field with its label (the form-layout renderer places fields one by one). */
export function CustomFieldControl({ def, value, onChange, idPrefix = 'cf', errorKey, className = '' }) {
  const id = `${idPrefix}-${def.key}`
  return (
    <Field
      label={<span id={`${id}-label`}>{def.label}{def.type !== 'number' && def.unit ? ` (${def.unit})` : ''}</span>}
      htmlFor={id}
      hint={def.helpText}
      required={def.required}
      error={errorKey === def.key ? 'Check this value' : undefined}
      className={className}
    >
      <FieldInput def={def} value={value} onChange={onChange} id={id} error={errorKey === def.key} />
    </Field>
  )
}

/**
 * Inputs for an entity's custom fields inside an existing form.
 *
 * Props: entity, value (object), onChange(nextObject), locationId (site of the
 * record, for site-scoped fields), core (built-in values, for 'core:'
 * conditions), errorKey (field key the server rejected), idPrefix, columns.
 */
export default function CustomFields({
  entity,
  value,
  onChange,
  locationId,
  core,
  errorKey,
  idPrefix = 'cf',
  columns = 2,
  title,
  applyDefaults = true,
}) {
  const defs = useCustomFieldDefs(entity)
  const values = useMemo(
    () =>
      applyDefaults && defs
        ? { ...defaultValues(defs, { locationId: locationId || null }), ...(value || {}) }
        : value || {},
    [applyDefaults, defs, locationId, value],
  )
  const shown = useMemo(
    () => (defs ? visibleDefs(defs, values, { locationId: locationId || null, core }) : []),
    [defs, values, locationId, core],
  )
  if (!shown.length) return null
  const set = (key, v) => onChange({ ...values, [key]: v })
  const grid = columns === 1 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'
  return (
    <fieldset className="space-y-3">
      {title && <legend className="text-sm font-semibold text-chart-ink mb-2">{title}</legend>}
      <div className={`grid gap-4 ${grid}`}>
        {shown.map((def) => {
          const id = `${idPrefix}-${def.key}`
          return (
            <Field
              key={def._id}
              label={<span id={`${id}-label`}>{def.label}{def.type !== 'number' && def.unit ? ` (${def.unit})` : ''}</span>}
              htmlFor={id}
              hint={def.helpText}
              required={def.required}
              error={errorKey === def.key ? 'Check this value' : undefined}
              className={def.type === 'long_text' || def.type === 'multiselect' ? 'sm:col-span-2' : ''}
            >
              <FieldInput def={def} value={values[def.key]} onChange={(v) => set(def.key, v)} id={id} error={errorKey === def.key} />
            </Field>
          )
        })}
      </div>
    </fieldset>
  )
}

/** Compact inputs for one line of a multi-row entry (daily entry, sampling). */
export function CustomFieldsInline({ entity, value, onChange, locationId, core, idPrefix }) {
  return (
    <CustomFields
      entity={entity}
      value={value}
      onChange={onChange}
      locationId={locationId}
      core={core}
      idPrefix={idPrefix}
      columns={2}
    />
  )
}

/** Read-only list of a record's custom values (archived fields included, labelled). */
export function CustomFieldValues({ entity, values, className = '' }) {
  const defs = useCustomFieldDefs(entity, { includeArchived: true })
  if (!defs || !values) return null
  const rows = defs
    .filter((d) => !isEmpty(values[d.key]))
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.sortOrder - b.sortOrder)
  if (!rows.length) return null
  return (
    <dl className={`grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 ${className}`}>
      {rows.map((d) => (
        <div key={d._id} className="min-w-0">
          <dt className="text-xs text-muted">{d.label}{d.archived ? ' (archived)' : ''}</dt>
          <dd className="text-sm text-chart-ink break-words">{formatValue(d, values[d.key])}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Detail-page card: shows a record's custom values and, for members who may
 * edit that record, edits them through customFields.setValues.
 */
export function CustomFieldsCard({ entity, recordId, values, locationId, core, editPermission, title = 'More details' }) {
  const defs = useCustomFieldDefs(entity)
  const canEdit = usePermission(editPermission)
  const setValues = useMutation(api.customFields.setValues)
  const { showToast } = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(values || {})
  const [errorKey, setErrorKey] = useState(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    if (!editing) setDraft(values || {})
  }, [values, editing])

  const hasValues = values && Object.values(values).some((v) => !isEmpty(v))
  if (!defs || (!defs.length && !hasValues)) return null

  const save = async () => {
    setSaving(true)
    setErrorKey(null)
    try {
      await setValues({ entity, id: recordId, custom: draft })
      showToast('success', 'Saved')
      setEditing(false)
    } catch (err) {
      setErrorKey(err?.data?.details?.field ?? null)
      showToast('error', errorMessage(err, 'Could not save'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title={title}
        action={
          canEdit && defs.length > 0 && !editing ? (
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>Edit</Button>
          ) : null
        }
      />
      {editing ? (
        <div className="space-y-4">
          <CustomFields
            entity={entity}
            value={draft}
            onChange={setDraft}
            locationId={locationId}
            core={core}
            errorKey={errorKey}
            idPrefix={`cf-${recordId}`}
            applyDefaults={false}
          />
          <div className="flex gap-2">
            <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
          </div>
        </div>
      ) : hasValues ? (
        <CustomFieldValues entity={entity} values={values} />
      ) : (
        <p className="text-sm text-muted">Nothing recorded yet.</p>
      )}
    </Card>
  )
}

/** Export helpers: column headers and cell text for an entity's custom fields. */
export function customColumns(defs) {
  return (defs || []).map((d) => ({ key: d.key, header: d.label + (d.archived ? ' (archived)' : ''), def: d }))
}
export function customCell(col, row) {
  return formatValue(col.def, row?.custom?.[col.key])
}
