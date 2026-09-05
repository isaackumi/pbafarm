import React, { useEffect, useMemo, useState } from 'react'
import { useQuery } from 'convex/react'
import { useRouter } from 'next/router'
import { api } from '../convex/_generated/api'
import fishTransferService from '../lib/fishTransferService'
import {
  Button,
  FormCard,
  FormActions,
  FormSection,
  Field,
  Input,
  Select,
  Textarea,
} from './ui'
import PersonPicker from './PersonPicker'
import { usePersistedForm } from '../hooks/usePersistedForm'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'

const TRANSFER_DEFAULTS = {
  transferDate: new Date().toISOString().split('T')[0],
  sourceCageId: '',
  destinationCageId: '',
  quantity: '',
  abw: '',
  fullTransfer: false,
  transferSupervisor: '',
  notes: '',
}

const DEFAULT_EMPTY = ['empty', 'fallow', 'harvested']

export default function FishTransferForm({ onCreated }) {
  const router = useRouter()
  const { user } = useAuth()
  const { showToast } = useToast()
  const settingsData = useQuery(api.companies.getEffectiveSettings)
  // Company-wide (no location filter) for cross-location transfers
  const allCages = useQuery(api.cages.list, user ? {} : 'skip')

  const { formData, handleChange, clear, setFormData } = usePersistedForm(
    'fish-transfer-create',
    TRANSFER_DEFAULTS,
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const emptyStatuses = useMemo(() => {
    const fromRules = settingsData?.settings?.stockingRules?.allowStockOnlyEmptyStatuses
    return Array.isArray(fromRules) && fromRules.length > 0
      ? fromRules
      : DEFAULT_EMPTY
  }, [settingsData])

  useEffect(() => {
    const sourceCageId = router.query?.sourceCageId
    if (!sourceCageId || typeof sourceCageId !== 'string') return
    setFormData((prev) =>
      prev.sourceCageId === sourceCageId
        ? prev
        : { ...prev, sourceCageId },
    )
  }, [router.query?.sourceCageId, setFormData])

  const sourceCages = useMemo(() => {
    if (!allCages) return []
    return allCages.filter(
      (c) => c.status === 'active' && (c.currentCount || 0) > 0,
    )
  }, [allCages])

  const source = useMemo(
    () => sourceCages.find((c) => (c.id || c._id) === formData.sourceCageId),
    [sourceCages, formData.sourceCageId],
  )

  const destCages = useMemo(() => {
    if (!allCages) return []
    return allCages.filter((c) => (c.id || c._id) !== formData.sourceCageId)
  }, [allCages, formData.sourceCageId])

  const dest = useMemo(
    () => destCages.find((c) => (c.id || c._id) === formData.destinationCageId),
    [destCages, formData.destinationCageId],
  )

  const sourceCount = source?.currentCount || 0
  const quantity = parseInt(formData.quantity, 10) || 0
  const abw = parseFloat(formData.abw) || 0
  const biomass = quantity > 0 && abw > 0 ? (quantity * abw) / 1000 : 0
  const isFull = quantity > 0 && quantity >= sourceCount && sourceCount > 0

  const destOutcome = useMemo(() => {
    if (!dest) return null
    if (emptyStatuses.includes(dest.status)) return 'new stocking (DOC = transfer date)'
    if (dest.status === 'active') return 'top-up existing batch'
    return `cannot receive transfer (status: ${dest.status})`
  }, [dest, emptyStatuses])

  useEffect(() => {
    if (!formData.fullTransfer || !source) return
    setFormData((prev) => ({
      ...prev,
      quantity: String(source.currentCount || 0),
    }))
  }, [formData.fullTransfer, source, setFormData])

  const onFullToggle = (e) => {
    const checked = e.target.checked
    setFormData((prev) => ({
      ...prev,
      fullTransfer: checked,
      quantity: checked && source ? String(source.currentCount || 0) : prev.quantity,
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!formData.sourceCageId || !formData.destinationCageId) {
      setError('Select source and destination cages')
      return
    }
    if (!quantity || quantity <= 0) {
      setError('Enter a valid quantity')
      return
    }
    if (!abw || abw <= 0) {
      setError('Enter a valid ABW (grams)')
      return
    }

    setLoading(true)
    try {
      const { data, error: err } = await fishTransferService.create({
        sourceCageId: formData.sourceCageId,
        destinationCageId: formData.destinationCageId,
        transferDate: formData.transferDate,
        quantity,
        abw,
        transferSupervisor: formData.transferSupervisor || undefined,
        notes: formData.notes || undefined,
      })
      if (err) throw err
      showToast('success', 'Fish transfer recorded')
      clear()
      onCreated?.(data)
    } catch (err) {
      const message = err?.message || 'Failed to create transfer'
      setError(message)
      showToast('error', message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <FormCard title="New fish transfer">
      <form onSubmit={handleSubmit} className="space-y-6">
        {error ? (
          <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-3 py-2">
            {error}
          </p>
        ) : null}

        <FormSection title="Move">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Transfer date" required>
              <Input
                type="date"
                name="transferDate"
                value={formData.transferDate}
                onChange={handleChange}
                required
              />
            </Field>
            <Field label="ABW (g)" required>
              <Input
                type="number"
                name="abw"
                className="font-data"
                min="0"
                step="0.1"
                value={formData.abw}
                onChange={handleChange}
                required
              />
            </Field>
          </div>

          <Field label="Source cage" required>
            <Select
              name="sourceCageId"
              value={formData.sourceCageId}
              onChange={handleChange}
              required
            >
              <option value="">Select stocked cage…</option>
              {sourceCages.map((c) => (
                <option key={c.id || c._id} value={c.id || c._id}>
                  {c.name}
                  {c.location ? ` · ${c.location}` : ''} —{' '}
                  {(c.currentCount || 0).toLocaleString()} fish
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Destination cage" required>
            <Select
              name="destinationCageId"
              value={formData.destinationCageId}
              onChange={handleChange}
              required
            >
              <option value="">Select destination…</option>
              {destCages.map((c) => {
                const label = emptyStatuses.includes(c.status)
                  ? 'Empty'
                  : c.status === 'active'
                    ? 'Occupied'
                    : c.status
                return (
                  <option key={c.id || c._id} value={c.id || c._id}>
                    {c.name}
                    {c.location ? ` · ${c.location}` : ''} — {label}
                    {c.status === 'active'
                      ? ` (${(c.currentCount || 0).toLocaleString()} fish)`
                      : ''}
                  </option>
                )
              })}
            </Select>
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
            <Field label="Quantity" required>
              <Input
                type="number"
                name="quantity"
                className="font-data"
                min="1"
                step="1"
                value={formData.quantity}
                onChange={(e) => {
                  handleChange(e)
                  setFormData((prev) => ({ ...prev, fullTransfer: false }))
                }}
                required
                disabled={formData.fullTransfer}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm font-medium pb-2">
              <input
                type="checkbox"
                checked={!!formData.fullTransfer}
                onChange={onFullToggle}
                disabled={!source}
              />
              Full transfer (empty source)
            </label>
          </div>

          <p className="text-sm text-muted">
            Biomass:{' '}
            <span className="font-data text-chart-ink">
              {biomass ? `${biomass.toFixed(2)} kg` : '—'}
            </span>
            {source ? (
              <>
                {' '}
                · Source has{' '}
                <span className="font-data">{sourceCount.toLocaleString()}</span>{' '}
                fish
              </>
            ) : null}
          </p>

          {(source || dest) && (
            <p className="text-sm rounded-md bg-foam-deep/60 px-3 py-2 text-chart-ink">
              {isFull
                ? 'Full transfer → source will be emptied.'
                : quantity > 0
                  ? `Partial → source keeps ${(sourceCount - quantity).toLocaleString()} fish.`
                  : 'Enter quantity to see source outcome.'}{' '}
              {destOutcome ? `Destination → ${destOutcome}.` : ''}
            </p>
          )}
        </FormSection>

        <FormSection title="Optional">
          <Field label="Transfer supervisor">
            <PersonPicker
              id="transferSupervisor"
              name="transferSupervisor"
              value={formData.transferSupervisor}
              onChange={handleChange}
            />
          </Field>
          <Field label="Notes">
            <Textarea
              name="notes"
              rows={3}
              value={formData.notes}
              onChange={handleChange}
            />
          </Field>
        </FormSection>

        <FormActions>
          <Button type="submit" disabled={loading || !allCages}>
            {loading ? 'Saving…' : 'Record transfer'}
          </Button>
        </FormActions>
      </form>
    </FormCard>
  )
}
