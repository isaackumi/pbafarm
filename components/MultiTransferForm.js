import React, { useMemo, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'
import { errorMessage } from '../lib/errorMessage'
import { Button, Field, FormActions, FormCard, FormSection, Input, Select, Textarea } from './ui'
import { localToday } from '../lib/format'

const today = () => localToday()
const blankLine = () => ({ key: Math.random().toString(36).slice(2), destinationCageId: '', quantity: '' })

/**
 * One transfer from a cage to several cages, saved as a single operation
 * (doc 05 §7.2): either every line is recorded or none is, and together they
 * can never take more fish than the source holds. Admin only.
 */
export default function MultiTransferForm({ initialSourceId = '', onCreated }) {
  const { user } = useAuth()
  const { showToast } = useToast()
  const cages = useQuery(api.cages.list, user ? {} : 'skip')
  const transferGroup = useMutation(api.batches.transferGroup)

  const [sourceCageId, setSourceCageId] = useState(initialSourceId)
  const [transferDate, setTransferDate] = useState(today())
  const [abw, setAbw] = useState('')
  const [lines, setLines] = useState([blankLine(), blankLine()])
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const list = useMemo(() => cages || [], [cages])
  const source = list.find((c) => String(c.id) === String(sourceCageId))
  const available = source?.current_count ?? 0
  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0)
  const remaining = available - total
  const sources = list.filter((c) => (c.current_count ?? 0) > 0)
  const chosen = new Set(lines.map((l) => String(l.destinationCageId)).filter(Boolean))

  const setLine = (key, patch) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    const filled = lines.filter((l) => l.destinationCageId || l.quantity)
    if (!sourceCageId) return setError('Choose the cage the fish leave')
    if (!(Number(abw) > 0)) return setError('Enter the average weight of the fish moved')
    if (!filled.length) return setError('Add at least one destination')
    if (filled.some((l) => !l.destinationCageId || !(Number.isInteger(Number(l.quantity)) && Number(l.quantity) > 0))) {
      return setError('Each destination needs a cage and a whole number of fish')
    }
    if (remaining < 0) return setError(`That is ${(-remaining).toLocaleString()} more fish than ${source?.name} holds`)
    setSaving(true)
    try {
      await transferGroup({
        sourceCageId,
        transferDate,
        lines: filled.map((l) => ({
          destinationCageId: l.destinationCageId,
          quantity: Number(l.quantity),
          abw: Number(abw),
        })),
        notes: notes.trim() || undefined,
      })
      showToast('success', `Moved ${total.toLocaleString()} fish to ${filled.length} cages`)
      setLines([blankLine(), blankLine()])
      setNotes('')
      onCreated?.()
    } catch (err) {
      const message = errorMessage(err, 'Could not save the transfer')
      setError(message)
      showToast('error', message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <FormCard title="Transfer to several cages">
      <form onSubmit={submit} className="space-y-6">
        <FormSection title="From">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Source cage" htmlFor="mt-source" required className="sm:col-span-1">
              <Select id="mt-source" value={sourceCageId} onChange={(e) => setSourceCageId(e.target.value)}>
                <option value="">Choose a cage</option>
                {sources.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({(c.current_count ?? 0).toLocaleString()} fish)
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date" htmlFor="mt-date" required>
              <Input id="mt-date" type="date" value={transferDate} max={today()} onChange={(e) => setTransferDate(e.target.value)} />
            </Field>
            <Field label="Average weight (g)" htmlFor="mt-abw" required hint="Of the fish moved">
              <Input id="mt-abw" type="number" inputMode="decimal" min="0" step="0.1" value={abw} onChange={(e) => setAbw(e.target.value)} />
            </Field>
          </div>
        </FormSection>

        <FormSection
          title="To"
          description="Empty cages start a cycle for the same batch; cages that already hold fish merge them into their batch."
        >
          <ul className="space-y-3">
            {lines.map((l, i) => (
              <li key={l.key} className="grid grid-cols-[1fr_7rem_auto] sm:grid-cols-[1fr_10rem_auto] items-end gap-3">
                <Field label={i === 0 ? 'Destination cage' : undefined} htmlFor={`mt-dest-${l.key}`}>
                  <Select
                    id={`mt-dest-${l.key}`}
                    aria-label={`Destination ${i + 1}`}
                    value={l.destinationCageId}
                    onChange={(e) => setLine(l.key, { destinationCageId: e.target.value })}
                  >
                    <option value="">Choose a cage</option>
                    {list
                      .filter(
                        (c) =>
                          String(c.id) !== String(sourceCageId) &&
                          (String(c.id) === String(l.destinationCageId) || !chosen.has(String(c.id))),
                      )
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {(c.current_count ?? 0) > 0 ? ` (${(c.current_count ?? 0).toLocaleString()} fish)` : ' (empty)'}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label={i === 0 ? 'Fish' : undefined} htmlFor={`mt-qty-${l.key}`}>
                  <Input
                    id={`mt-qty-${l.key}`}
                    aria-label={`Fish to destination ${i + 1}`}
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    value={l.quantity}
                    onChange={(e) => setLine(l.key, { quantity: e.target.value })}
                  />
                </Field>
                <Button
                  variant="ghost"
                  size="md"
                  aria-label={`Remove destination ${i + 1}`}
                  disabled={lines.length === 1}
                  onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button variant="secondary" size="sm" disabled={lines.length >= 20} onClick={() => setLines((ls) => [...ls, blankLine()])}>
              Add destination
            </Button>
            {source && (
              <p className={`text-sm tabular-nums ${remaining < 0 ? 'text-signal' : 'text-muted'}`}>
                {total.toLocaleString()} of {available.toLocaleString()} fish,{' '}
                {remaining >= 0 ? `${remaining.toLocaleString()} stay in ${source.name}` : `${(-remaining).toLocaleString()} too many`}
              </p>
            )}
          </div>
        </FormSection>

        <Field label="Notes" htmlFor="mt-notes">
          <Textarea id="mt-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        {error && <p className="text-sm text-signal" role="alert">{error}</p>}
        <FormActions>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save transfer'}
          </Button>
        </FormActions>
      </form>
    </FormCard>
  )
}
