import React, { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { useRouter } from 'next/router'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { errorMessage } from '../lib/errorMessage'
import { Button, Field, FormActions, FormCard, FormSection, Input, LoadingState, Select, Textarea } from './ui'
import { localToday } from '../lib/format'

const today = () => localToday()
const newGrade = (cageId = '') => ({
  key: Math.random().toString(36).slice(2),
  cageId,
  quantity: '',
  abw: '',
  batchNumber: '',
})

/**
 * Grade every fish in a cage into size grades (doc 05 §7.3). Each grade
 * becomes a child batch in the cage it goes to; culls are recorded as deaths;
 * fish the grades do not account for are recorded as unaccounted.
 */
export default function GradingForm({ initialCageId = '' }) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const router = useRouter()
  const cages = useQuery(api.cages.list, user ? {} : 'skip')
  const grade = useMutation(api.batches.grade)

  const [cageId, setCageId] = useState(initialCageId)
  const [date, setDate] = useState(today())
  const [grades, setGrades] = useState([newGrade(initialCageId), newGrade()])
  const [culls, setCulls] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const list = useMemo(() => cages || [], [cages])
  const source = list.find((c) => String(c.id) === String(cageId))
  const available = source?.current_count ?? 0
  const graded = grades.reduce((s, g) => s + (Number(g.quantity) || 0), 0) + (Number(culls) || 0)
  const gap = available - graded
  // A grade can go back into the graded cage or into an empty one.
  const targets = list.filter((c) => String(c.id) === String(cageId) || (c.current_count ?? 0) === 0)
  const setGrade = (key, patch) => setGrades((gs) => gs.map((g) => (g.key === key ? { ...g, ...patch } : g)))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    const filled = grades.filter((g) => g.cageId || g.quantity || g.abw)
    if (!cageId) return setError('Choose the cage being graded')
    if (!filled.length) return setError('Add at least one grade')
    if (filled.some((g) => !g.cageId || !(Number.isInteger(Number(g.quantity)) && Number(g.quantity) > 0) || !(Number(g.abw) > 0))) {
      return setError('Each grade needs a cage, a whole number of fish and an average weight')
    }
    if (new Set(filled.map((g) => g.cageId)).size !== filled.length) return setError('Each cage can take one grade')
    setSaving(true)
    try {
      const r = await grade({
        cageId,
        date,
        outputs: filled.map((g) => ({
          cageId: g.cageId,
          quantity: Number(g.quantity),
          abw: Number(g.abw),
          batchNumber: g.batchNumber.trim() || undefined,
        })),
        culls: Number(culls) || 0,
        reason: reason.trim() || undefined,
      })
      showToast(
        'success',
        r.unaccounted
          ? `Graded into ${r.childBatchIds.length} batches; ${r.unaccounted.toLocaleString()} fish unaccounted`
          : `Graded into ${r.childBatchIds.length} batches`,
      )
      router.push(`/batches/${r.childBatchIds[0]}`)
    } catch (err) {
      const message = errorMessage(err, 'Could not save the grading')
      setError(message)
      showToast('error', message)
    } finally {
      setSaving(false)
    }
  }

  if (cages === undefined) {
    return (
      <FormCard title="Grade a cage">
        <LoadingState label="Loading cages…" />
      </FormCard>
    )
  }

  return (
    <FormCard title="Grade a cage">
      <form onSubmit={submit} className="space-y-6">
        <FormSection title="Cage">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Cage being graded" htmlFor="gr-cage" required>
              <Select
                id="gr-cage"
                value={cageId}
                onChange={(e) => {
                  setCageId(e.target.value)
                  setGrades((gs) => gs.map((g, i) => (i === 0 ? { ...g, cageId: e.target.value } : g)))
                }}
              >
                <option value="">Choose a cage</option>
                {list
                  .filter((c) => (c.current_count ?? 0) > 0)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({(c.current_count ?? 0).toLocaleString()} fish)
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Date" htmlFor="gr-date" required>
              <Input id="gr-date" type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
        </FormSection>

        <FormSection
          title="Grades"
          description="Each grade becomes its own batch, linked to the batch it came from."
        >
          <ul className="space-y-4">
            {grades.map((g, i) => (
              <li key={g.key} className="rounded-input border border-line p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-text">Grade {i + 1}</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={grades.length === 1}
                    onClick={() => setGrades((gs) => gs.filter((x) => x.key !== g.key))}
                  >
                    Remove
                  </Button>
                </div>
                <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
                  <Field label="Goes to" htmlFor={`gr-to-${g.key}`} className="col-span-2 sm:col-span-1">
                    <Select id={`gr-to-${g.key}`} value={g.cageId} onChange={(e) => setGrade(g.key, { cageId: e.target.value })}>
                      <option value="">Choose a cage</option>
                      {targets.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {String(c.id) === String(cageId) ? ' (stays)' : ' (empty)'}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Fish" htmlFor={`gr-qty-${g.key}`}>
                    <Input
                      id={`gr-qty-${g.key}`}
                      type="number"
                      inputMode="numeric"
                      min="1"
                      step="1"
                      value={g.quantity}
                      onChange={(e) => setGrade(g.key, { quantity: e.target.value })}
                    />
                  </Field>
                  <Field label="Average weight (g)" htmlFor={`gr-abw-${g.key}`}>
                    <Input
                      id={`gr-abw-${g.key}`}
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.1"
                      value={g.abw}
                      onChange={(e) => setGrade(g.key, { abw: e.target.value })}
                    />
                  </Field>
                  <Field label="Batch number" htmlFor={`gr-bn-${g.key}`} hint="Optional">
                    <Input id={`gr-bn-${g.key}`} value={g.batchNumber} onChange={(e) => setGrade(g.key, { batchNumber: e.target.value })} />
                  </Field>
                </div>
              </li>
            ))}
          </ul>
          <Button variant="secondary" size="sm" disabled={grades.length >= 20} onClick={() => setGrades((gs) => [...gs, newGrade()])}>
            Add grade
          </Button>
        </FormSection>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Culled" htmlFor="gr-culls" hint="Recorded as deaths">
            <Input id="gr-culls" type="number" inputMode="numeric" min="0" step="1" value={culls} onChange={(e) => setCulls(e.target.value)} />
          </Field>
          <Field label="Notes" htmlFor="gr-reason">
            <Textarea id="gr-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>

        {source && (
          <p className={`text-sm tabular-nums ${gap < 0 ? 'text-alert' : 'text-muted'}`}>
            {graded.toLocaleString()} of {available.toLocaleString()} fish graded or culled
            {gap > 0 ? `; ${gap.toLocaleString()} will be recorded as unaccounted` : ''}
            {gap < 0 ? `; ${(-gap).toLocaleString()} more than on record` : ''}
          </p>
        )}
        {error && <p className="text-sm text-alert" role="alert">{error}</p>}
        <FormActions>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save grading'}
          </Button>
        </FormActions>
      </form>
    </FormCard>
  )
}
