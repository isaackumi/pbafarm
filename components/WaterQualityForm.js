import { useState } from 'react'
import { Button, Field, Input, Textarea } from './ui'
import { WQ_PARAMETERS } from '../convex/lib/waterQuality'
import { t as translate } from '../lib/i18n'
import { useT } from '../lib/i18n/context'

/** A parameter's name in the active language. */
function paramLabel(t, key) {
  return t.or(`wq.param.${key}`, WQ_PARAMETERS[key].label)
}

/** Fields shown first for each unit type; the rest sit behind "More". */
const PRIMARY = {
  cage: ['dissolvedOxygen', 'temperatureC', 'secchiCm', 'ph'],
  pond: ['dissolvedOxygen', 'temperatureC', 'ph', 'secchiCm', 'ammonia'],
  tank: ['dissolvedOxygen', 'temperatureC', 'ph', 'ammonia', 'nitrite', 'nitrate'],
  raceway: ['dissolvedOxygen', 'temperatureC', 'ph', 'ammonia'],
}

const EMPTY = Object.fromEntries(Object.keys(WQ_PARAMETERS).map((k) => [k, '']))

/** Values the user typed, as numbers; blank stays out (blank is not zero). */
export function readingArgs(form) {
  const out = {}
  for (const k of Object.keys(WQ_PARAMETERS)) {
    const raw = form[k]
    if (raw === '' || raw == null) continue
    const n = Number(raw)
    if (!Number.isFinite(n)) throw new Error(translate('wq.mustBeNumber', { label: translate(`wq.param.${k}`) }))
    out[k] = n
  }
  if (!Object.keys(out).length) throw new Error(translate('wq.atLeastOne'))
  return out
}

/**
 * Water-quality entry for one unit. `onSave({ values, notes, measuredAt })`
 * resolves to true to clear the form.
 */
export default function WaterQualityForm({ unitType = 'cage', onSave, idPrefix = 'wq', compact = false }) {
  const t = useT()
  const [form, setForm] = useState({ ...EMPTY, notes: '', time: '' })
  const [more, setMore] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const primary = PRIMARY[unitType] || PRIMARY.tank
  const keys = more ? Object.keys(WQ_PARAMETERS) : primary

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    let values
    try {
      values = readingArgs(form)
    } catch (err) {
      setError(err.message)
      return
    }
    setSaving(true)
    try {
      const measuredAt = form.time ? new Date(form.time).getTime() : undefined
      const ok = await onSave({ values, notes: form.notes.trim() || undefined, measuredAt })
      if (ok) setForm({ ...EMPTY, notes: '', time: '' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className={`grid grid-cols-2 ${compact ? '' : 'sm:grid-cols-3'} gap-3`}>
        {keys.map((k) => {
          const spec = WQ_PARAMETERS[k]
          return (
            <Field key={k} label={`${paramLabel(t, k)}${spec.unit ? ` (${spec.unit})` : ''}`} htmlFor={`${idPrefix}-${k}`}>
              <Input
                id={`${idPrefix}-${k}`}
                type="number"
                step="any"
                inputMode="decimal"
                className="font-data tabular-nums"
                value={form[k]}
                onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
              />
            </Field>
          )
        })}
      </div>
      <button type="button" className="text-sm text-lake hover:underline" onClick={() => setMore((m) => !m)}>
        {more ? t('wq.fewer') : t('wq.more')}
      </button>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={t('wq.measuredAt')} htmlFor={`${idPrefix}-time`} hint={t('wq.leaveBlank')}>
          <Input
            id={`${idPrefix}-time`}
            type="datetime-local"
            value={form.time}
            onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
          />
        </Field>
        <Field label={t('common.notes')} htmlFor={`${idPrefix}-notes`}>
          <Textarea id={`${idPrefix}-notes`} rows={1} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </Field>
      </div>
      {error && <p className="text-sm text-signal">{error}</p>}
      <Button type="submit" disabled={saving} className="w-full sm:w-auto">
        {saving ? t('common.saving') : t('wq.saveReading')}
      </Button>
    </form>
  )
}
