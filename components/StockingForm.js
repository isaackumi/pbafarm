import React, { useCallback, useMemo, useState, useEffect } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { useRouter } from 'next/router'
import { api } from '../convex/_generated/api'
import {
  Button,
  FormCard,
  FormActions,
  Field,
  Input,
  Select,
  Textarea,
} from './ui'
import DependencyEmpty from './DependencyEmpty'
import PersonPicker from './PersonPicker'
import FarmLocationSelect from './FarmLocationSelect'
import { usePersistedForm } from '../hooks/usePersistedForm'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import { useSpeciesOptions } from '../hooks/useSpeciesOptions'
import { localToday } from '../lib/format'
import { customPayload } from './CustomFields'
import { stockingCreateArgs } from '../lib/recordArgs'
import FormLayout, { hiddenCoreKeys, useFormLayout } from './FormLayout'
import { DEFAULT_SETTINGS, densityStatus } from '../convex/lib/farmRules'

const STOCKING_DEFAULTS = {
  cageId: '',
  batchNumber: '',
  stockingDate: localToday(),
  fishCount: '',
  averageBodyWeight: '',
  species: 'nile_tilapia',
  sourceLocation: '',
  transferSupervisor: '',
  samplingSupervisor: '',
  notes: '',
  custom: {},
}

const DEFAULT_STOCKABLE = ['empty', 'fallow', 'harvested']

const StockingForm = ({ onSuccess, onCancel }) => {
  const router = useRouter()
  const { user } = useAuth()
  const { locationArgs } = useLocation()
  const settingsData = useQuery(api.companies.getEffectiveSettings)
  const rules = settingsData?.settings
  const allCages = useQuery(api.cages.list, user ? locationArgs : 'skip')
  const createStocking = useMutation(api.stocking.createStocking)

  const { formData, handleChange, clear, setFormData } = usePersistedForm(
    'stocking-create',
    STOCKING_DEFAULTS,
  )
  const speciesOptions = useSpeciesOptions(formData.species)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [warn, setWarn] = useState([])
  const layout = useFormLayout('production.stocking')
  const setCustom = useCallback((custom) => setFormData((prev) => ({ ...prev, custom })), [setFormData])

  const stockableStatuses = useMemo(() => {
    const fromRules = rules?.stockingRules?.allowStockOnlyEmptyStatuses
    return Array.isArray(fromRules) && fromRules.length > 0
      ? fromRules
      : DEFAULT_STOCKABLE
  }, [rules])

  const cagesReady = allCages !== undefined
  const cages = useMemo(() => {
    if (!allCages) return []
    return allCages.filter((cage) => stockableStatuses.includes(cage.status))
  }, [allCages, stockableStatuses])

  const suggestedBatch = useQuery(
    api.stocking.suggestBatchNumber,
    user && formData.cageId
      ? {
          cageId: formData.cageId,
          stockingDate: formData.stockingDate || undefined,
        }
      : 'skip',
  )

  useEffect(() => {
    if (!suggestedBatch) return
    setFormData((prev) => {
      // Only overwrite empty or previously auto-filled values
      if (prev.batchNumber && !prev._batchAuto) return prev
      return { ...prev, batchNumber: suggestedBatch, _batchAuto: true }
    })
  }, [suggestedBatch, setFormData])

  const handleBatchChange = (e) => {
    const value = e.target.value
    setFormData((prev) => ({
      ...prev,
      batchNumber: value,
      _batchAuto: false,
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const fishCount = parseInt(formData.fishCount, 10)
      const initialAbw = parseFloat(formData.averageBodyWeight)
      const sr = rules?.stockingRules
      if (!formData.cageId) throw new Error('Select a cage')
      if (!fishCount || fishCount < 1) throw new Error('Enter a valid fish count')
      if (!initialAbw || initialAbw <= 0) {
        throw new Error('Enter average body weight in grams')
      }
      if (
        sr &&
        (initialAbw < sr.minInitialAbwG || initialAbw > sr.maxInitialAbwG)
      ) {
        throw new Error(
          `Initial ABW must be between ${sr.minInitialAbwG}g and ${sr.maxInitialAbwG}g (you entered ${initialAbw}g). Change Company Settings → Stocking rules if your farm stocks outside this range.`,
        )
      }

      setLoading(true)
      const hidden = hiddenCoreKeys(layout.sections, formData, formData.custom)
      const optional = (key) => (hidden.has(key) ? '' : formData[key])
      const stockingData = {
        cage_id: formData.cageId,
        stocking_date: formData.stockingDate,
        fish_count: fishCount,
        initial_abw: initialAbw,
        species: formData.species || undefined,
        batch_number: optional('batchNumber'),
        source_location: optional('sourceLocation'),
        transfer_supervisor: optional('transferSupervisor'),
        sampling_supervisor: optional('samplingSupervisor'),
        notes: optional('notes'),
        custom: customPayload(formData.custom),
      }

      await createStocking(stockingCreateArgs(stockingData))

      clear()
      setFormData({
        ...STOCKING_DEFAULTS,
        stockingDate: localToday(),
      })
      if (onSuccess) onSuccess()
      else router.push('/stocking-management')
    } catch (err) {
      console.error('Error creating stocking record:', err)
      setError(err.message || 'Error creating stocking record')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!rules) return
    const notes = []
    const count = Number(formData.fishCount)
    const abw = Number(formData.averageBodyWeight)
    const cage = cages.find((c) => (c._id || c.id) === formData.cageId)
    const sr = rules.stockingRules
    const fr = rules.farmRules
    if (abw && (abw < sr.minInitialAbwG || abw > sr.maxInitialAbwG)) {
      notes.push(`ABW should be ${sr.minInitialAbwG}–${sr.maxInitialAbwG}g`)
    }
    if (cage?.capacity && count > cage.capacity && sr.enforceCageCapacity) {
      notes.push(`Exceeds cage capacity (${cage.capacity})`)
    }
    if (cage && count > 0) {
      // Same basis as the server check: pond area, cage net volume, tank volume.
      const d = densityStatus(cage, count, { ...DEFAULT_SETTINGS.farmRules, ...fr })
      if (d.level === 'over') {
        notes.push(`Density ${d.density} ${d.unit} exceeds the limit of ${d.max} ${d.unit}`)
      } else if (d.level === 'warn') {
        notes.push(`Density ${d.density} ${d.unit} is ${d.pctOfMax}% of the limit (${d.max})`)
      }
    }
    if (sr.requireApprovalForStocking) {
      notes.push('This stocking will require admin approval')
    } else {
      notes.push('This stocking will activate the cage immediately')
    }
    setWarn(notes)
  }, [formData, cages, rules])

  // Drop stale cage selection if it is no longer stockable
  useEffect(() => {
    if (!cagesReady || !formData.cageId) return
    const stillThere = cages.some(
      (c) => (c.id || c._id) === formData.cageId,
    )
    if (!stillThere) {
      setFormData((prev) => ({ ...prev, cageId: '' }))
    }
  }, [cages, cagesReady, formData.cageId, setFormData])

  const layoutFields = {
    cageId: (
      <Field label="Cage" htmlFor="cageId" required>
        <Select
          id="cageId"
          name="cageId"
          value={formData.cageId}
          onChange={handleChange}
          required
          disabled={!cagesReady || cages.length === 0}
        >
          <option value="">
            {!cagesReady
              ? 'Loading cages…'
              : cages.length === 0
                ? 'No stockable cages available'
                : 'Choose available cage…'}
          </option>
          {cages.map((cage) => (
            <option key={cage._id || cage.id} value={cage._id || cage.id}>
              {cage.name} — {cage.status}
            </option>
          ))}
        </Select>
        {cagesReady && cages.length === 0 && (
          <DependencyEmpty
            message={`Stocking needs a cage with status ${stockableStatuses.join(', ')}. Create a cage or harvest/empty an active one first.${
              allCages?.length
                ? ` (${allCages.length} cage${allCages.length === 1 ? '' : 's'} on farm, none stockable right now.)`
                : ''
            }`}
            createKind="cage"
            createLabel="Create a cage"
            secondaryHref="/cages"
            secondaryLabel="Manage cages"
            onCreated={(result) => {
              const id = result?.id || result?.record?._id || result?.record?.id
              if (id) {
                setFormData((prev) => ({ ...prev, cageId: id }))
              }
            }}
          />
        )}
      </Field>
    ),
    batchNumber: (
      <Field
        label="Batch number"
        htmlFor="batchNumber"
        hint="Auto-generated from cage + date; edit if needed"
      >
        <Input
          id="batchNumber"
          type="text"
          name="batchNumber"
          value={formData.batchNumber}
          onChange={handleBatchChange}
          placeholder={
            formData.cageId
              ? suggestedBatch || 'Generating…'
              : 'Select a cage first'
          }
        />
      </Field>
    ),
    stockingDate: (
      <Field label="Stocking date" htmlFor="stockingDate" required>
        <Input
          id="stockingDate"
          type="date"
          name="stockingDate"
          value={formData.stockingDate}
          onChange={handleChange}
          required
        />
      </Field>
    ),
    species: (
      <Field label="Species" htmlFor="species" required>
        <Select
          id="species"
          name="species"
          value={formData.species}
          onChange={handleChange}
          required
        >
          {speciesOptions.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </Field>
    ),
    fishCount: (
      <Field label="Fish count" htmlFor="fishCount" required>
        <Input
          id="fishCount"
          type="number"
          name="fishCount"
          value={formData.fishCount}
          onChange={handleChange}
          min="1"
          required
          className="font-data"
        />
      </Field>
    ),
    averageBodyWeight: (
      <Field
        label="Average body weight (g)"
        htmlFor="averageBodyWeight"
        required
        hint={
          rules?.stockingRules
            ? `Fingerling size for initial stocking: ${rules.stockingRules.minInitialAbwG}–${rules.stockingRules.maxInitialAbwG}g (not kg). Adjust in Company Settings if needed.`
            : 'Enter weight in grams (not kg).'
        }
      >
        <Input
          id="averageBodyWeight"
          type="number"
          name="averageBodyWeight"
          step="0.1"
          value={formData.averageBodyWeight}
          onChange={handleChange}
          min={rules?.stockingRules?.minInitialAbwG ?? 1}
          max={rules?.stockingRules?.maxInitialAbwG ?? 500}
          required
          className="font-data"
        />
      </Field>
    ),
    sourceLocation: (
      <Field
        label="Source location"
        htmlFor="sourceLocation"
       
        hint="Defaults to header location"
      >
        <FarmLocationSelect
          id="sourceLocation"
          name="sourceLocation"
          value={formData.sourceLocation}
          onChange={handleChange}
          valueKind="name"
          locked
        />
      </Field>
    ),
    transferSupervisor: (
      <Field
        label="Transfer supervisor"
        htmlFor="transferSupervisor"
        hint="Pick a user or type a name"
      >
        <PersonPicker
          id="transferSupervisor"
          name="transferSupervisor"
          value={formData.transferSupervisor}
          onChange={handleChange}
        />
      </Field>
    ),
    samplingSupervisor: (
      <Field
        label="Sampling supervisor"
        htmlFor="samplingSupervisor"
        hint="Pick a user or type a name"
      >
        <PersonPicker
          id="samplingSupervisor"
          name="samplingSupervisor"
          value={formData.samplingSupervisor}
          onChange={handleChange}
        />
      </Field>
    ),
    notes: (
      <Field label="Optional notes" htmlFor="notes">
        <Textarea
          id="notes"
          name="notes"
          value={formData.notes}
          onChange={handleChange}
        />
      </Field>
    ),
  }

  const selectedCage = cages.find((c) => (c._id || c.id) === formData.cageId)

  return (
    <FormCard
      title="Stocking details"
      subtitle="Fill in batch and fish metrics for an available cage. Drafts survive a refresh."
    >
      {error && (
        <div className="mb-5 text-sm text-alert border border-[var(--pill-red-border)] bg-[color-mix(in_oklab,var(--alert)_8%,transparent)] rounded-input p-3">
          {error}
        </div>
      )}
      {warn.length > 0 && (
        <div className="mb-5 text-sm text-warn border border-[var(--pill-amber-border)] bg-[color-mix(in_oklab,var(--warn)_8%,transparent)] rounded-input p-3 space-y-1">
          {warn.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        <FormLayout
          formKey="production.stocking"
          layout={layout}
          fields={layoutFields}
          coreValues={formData}
          custom={formData.custom}
          onCustomChange={setCustom}
          locationId={selectedCage?.location_id}
          core={{ species: formData.species, fishCount: Number(formData.fishCount) || 0 }}
          idPrefix="st-cf"
        />

        <FormActions>
          <Button type="submit" disabled={loading || cages.length === 0} size="lg">
            {loading ? 'Creating…' : 'Create stocking'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={onCancel || (() => router.push('/cages'))}
          >
            Cancel
          </Button>
        </FormActions>
      </form>
    </FormCard>
  )
}

export default StockingForm
