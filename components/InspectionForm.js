import { useState } from 'react'
import { Button, Field, Input, Select, Textarea } from './ui'
import { localToday } from '../lib/format'

/** Default net inspection checklist (CAGE-002); mirrors convex/equipment.ts. */
export const NET_CHECKLIST = [
  'Net free of holes and tears',
  'Seams and lacing intact',
  'Fouling acceptable',
  'Weights and sinker tube in place',
  'Mooring lines and buoys sound',
  'Bird and predator net intact',
  'Walkway and frame safe',
]

export const INSPECTION_KINDS = [
  { value: 'net_inspection', label: 'Net inspection' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'repair', label: 'Repair' },
  { value: 'cleaning', label: 'Cleaning' },
  { value: 'calibration', label: 'Calibration' },
  { value: 'inspection', label: 'Inspection' },
]

const RESULTS = [
  { value: 'ok', label: 'OK' },
  { value: 'needs_attention', label: 'Needs attention' },
  { value: 'failed', label: 'Failed' },
]

/**
 * Inspection / maintenance entry for a unit. `equipment` lists what can be
 * chosen as the target; `spares` the inventory items that can be issued.
 * `onSave(args)` gets the mutation args (without unitId) and resolves to
 * true to reset the form.
 */
export default function InspectionForm({ unitType = 'cage', equipment = [], spares = [], onSave, idPrefix = 'insp' }) {
  const defaultKind = unitType === 'cage' ? 'net_inspection' : 'maintenance'
  const fresh = (kind = defaultKind) => ({
    kind,
    equipmentId: '',
    date: localToday(),
    result: 'ok',
    findings: '',
    actionsTaken: '',
    nextDueOn: '',
    performedBy: '',
    checklist: kind === 'net_inspection' ? NET_CHECKLIST.map((item) => ({ item, ok: true, note: '' })) : [],
    partId: '',
    partQty: '',
  })
  const [form, setForm] = useState(() => fresh())
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const failed = form.checklist.filter((c) => !c.ok).length

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      const args = {
        kind: form.kind,
        date: form.date,
        result: failed && form.result === 'ok' ? 'needs_attention' : form.result,
        equipmentId: form.equipmentId || undefined,
        findings: form.findings.trim() || undefined,
        actionsTaken: form.actionsTaken.trim() || undefined,
        nextDueOn: form.nextDueOn || undefined,
        performedBy: form.performedBy.trim() || undefined,
        checklist: form.checklist.length
          ? form.checklist.map((c) => ({ item: c.item, ok: c.ok, note: c.note.trim() || undefined }))
          : undefined,
        partsUsed:
          form.partId && Number(form.partQty) > 0
            ? [{ itemId: form.partId, quantity: Number(form.partQty) }]
            : undefined,
      }
      const ok = await onSave(args)
      if (ok) setForm(fresh(form.kind))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Field label="Type" htmlFor={`${idPrefix}-kind`}>
          <Select id={`${idPrefix}-kind`} value={form.kind} onChange={(e) => setForm(fresh(e.target.value))}>
            {INSPECTION_KINDS.filter((k) => k.value !== 'net_inspection' || unitType === 'cage' || unitType === 'hapa').map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Date" htmlFor={`${idPrefix}-date`}>
          <Input id={`${idPrefix}-date`} type="date" value={form.date} max={localToday()} onChange={set('date')} />
        </Field>
        {form.kind !== 'net_inspection' && equipment.length > 0 && (
          <Field label="Equipment" htmlFor={`${idPrefix}-eq`}>
            <Select id={`${idPrefix}-eq`} value={form.equipmentId} onChange={set('equipmentId')}>
              <option value="">The unit itself</option>
              {equipment.map((e) => (
                <option key={e._id} value={e._id}>{e.name}</option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      {form.checklist.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-chart-ink mb-1">Checklist</legend>
          {form.checklist.map((c, i) => (
            <div key={c.item} className="rounded-lg border border-foam-deep p-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">{c.item}</span>
                <div className="flex shrink-0 rounded-lg border border-foam-deep overflow-hidden" role="group" aria-label={c.item}>
                  {[true, false].map((val) => (
                    <button
                      key={String(val)}
                      type="button"
                      aria-pressed={c.ok === val}
                      onClick={() =>
                        setForm((f) => ({ ...f, checklist: f.checklist.map((x, j) => (j === i ? { ...x, ok: val } : x)) }))
                      }
                      className={`px-3 min-h-11 sm:min-h-9 text-sm ${
                        c.ok === val ? (val ? 'bg-kelp text-white' : 'bg-signal text-white') : 'bg-surface text-muted'
                      }`}
                    >
                      {val ? 'OK' : 'Fault'}
                    </button>
                  ))}
                </div>
              </div>
              {!c.ok && (
                <Input
                  aria-label={`Note for ${c.item}`}
                  className="mt-2"
                  placeholder="What is wrong?"
                  value={c.note}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, checklist: f.checklist.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)) }))
                  }
                />
              )}
            </div>
          ))}
        </fieldset>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Field label="Result" htmlFor={`${idPrefix}-result`} hint={failed ? `${failed} checklist fault(s)` : undefined}>
          <Select id={`${idPrefix}-result`} value={failed && form.result === 'ok' ? 'needs_attention' : form.result} onChange={set('result')}>
            {RESULTS.filter((r) => !(failed && r.value === 'ok')).map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Next due" htmlFor={`${idPrefix}-next`} hint="Blank: from the equipment interval">
          <Input id={`${idPrefix}-next`} type="date" value={form.nextDueOn} min={form.date} onChange={set('nextDueOn')} />
        </Field>
        <Field label="Done by" htmlFor={`${idPrefix}-by`}>
          <Input id={`${idPrefix}-by`} value={form.performedBy} onChange={set('performedBy')} />
        </Field>
        <Field label="Findings" htmlFor={`${idPrefix}-findings`} className="col-span-2 sm:col-span-3">
          <Textarea id={`${idPrefix}-findings`} rows={2} value={form.findings} onChange={set('findings')} />
        </Field>
        <Field label="Actions taken" htmlFor={`${idPrefix}-actions`} className="col-span-2 sm:col-span-3">
          <Textarea id={`${idPrefix}-actions`} rows={2} value={form.actionsTaken} onChange={set('actionsTaken')} />
        </Field>
        {spares.length > 0 && (
          <>
            <Field label="Spare part used" htmlFor={`${idPrefix}-part`} hint="Issued from inventory">
              <Select id={`${idPrefix}-part`} value={form.partId} onChange={set('partId')}>
                <option value="">None</option>
                {spares.map((s) => (
                  <option key={s._id || s.id} value={s._id || s.id}>{s.name}</option>
                ))}
              </Select>
            </Field>
            {form.partId && (
              <Field label="Quantity" htmlFor={`${idPrefix}-qty`}>
                <Input id={`${idPrefix}-qty`} type="number" step="any" min="0" inputMode="decimal" value={form.partQty} onChange={set('partQty')} />
              </Field>
            )}
          </>
        )}
      </div>
      <Button type="submit" disabled={saving} className="w-full sm:w-auto">
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </form>
  )
}
