import React, { useMemo, useState, useEffect } from 'react'
import { useQuery } from 'convex/react'
import { useRouter } from 'next/router'
import stockingService from '../lib/stockingService'
import { api } from '../convex/_generated/api'
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
import DependencyEmpty from './DependencyEmpty'
import { usePersistedForm } from '../hooks/usePersistedForm'
import { useAuth } from '../contexts/AuthContext'

const STOCKING_DEFAULTS = {
  cageId: '',
  batchNumber: '',
  stockingDate: new Date().toISOString().split('T')[0],
  fishCount: '',
  averageBodyWeight: '',
  sourceLocation: '',
  transferSupervisor: '',
  samplingSupervisor: '',
  notes: '',
}

const DEFAULT_STOCKABLE = ['empty', 'fallow', 'harvested']

const StockingForm = ({ onSuccess, onCancel }) => {
  const router = useRouter()
  const { user } = useAuth()
  const settingsData = useQuery(api.companies.getEffectiveSettings)
  const rules = settingsData?.settings
  const allCages = useQuery(api.cages.list, user ? {} : 'skip')

  const { formData, handleChange, clear, setFormData } = usePersistedForm(
    'stocking-create',
    STOCKING_DEFAULTS,
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [warn, setWarn] = useState([])

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

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      setLoading(true)
      const stockingData = {
        cage_id: formData.cageId,
        batch_number: formData.batchNumber,
        stocking_date: formData.stockingDate,
        fish_count: parseInt(formData.fishCount, 10),
        initial_abw: parseFloat(formData.averageBodyWeight),
        source_location: formData.sourceLocation,
        transfer_supervisor: formData.transferSupervisor,
        sampling_supervisor: formData.samplingSupervisor,
        notes: formData.notes,
      }

      const response = await stockingService.createStocking(stockingData)
      if (response.error) throw response.error

      clear()
      setFormData({
        ...STOCKING_DEFAULTS,
        stockingDate: new Date().toISOString().split('T')[0],
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
    if (cage?.size && count > 0 && count / cage.size > fr.maxDensityFishPerM3) {
      notes.push(`Exceeds max density ${fr.maxDensityFishPerM3} fish/m³`)
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

  return (
    <FormCard
      title="Stocking details"
      subtitle="Fill in batch and fish metrics for an available cage. Drafts survive a refresh."
    >
      {error && (
        <div className="mb-5 text-sm text-signal border border-signal/20 bg-signal/10 rounded-xl p-3">
          {error}
        </div>
      )}
      {warn.length > 0 && (
        <div className="mb-5 text-sm text-amber-800 border border-amber-200 bg-amber-50 rounded-xl p-3 space-y-1">
          {warn.map((w) => (
            <p key={w}>{w}</p>
          ))}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        <FormSection title="Cage & batch">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="Cage" htmlFor="cageId" required className="md:col-span-2">
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
                    if (result?.id) {
                      setFormData((prev) => ({ ...prev, cageId: result.id }))
                    }
                  }}
                />
              )}
            </Field>
            <Field label="Batch number" htmlFor="batchNumber" required>
              <Input
                id="batchNumber"
                type="text"
                name="batchNumber"
                value={formData.batchNumber}
                onChange={handleChange}
                required
              />
            </Field>
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
          </div>
        </FormSection>

        <FormSection title="Fish metrics">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
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
            <Field label="Average body weight (g)" htmlFor="averageBodyWeight" required>
              <Input
                id="averageBodyWeight"
                type="number"
                name="averageBodyWeight"
                step="0.1"
                value={formData.averageBodyWeight}
                onChange={handleChange}
                min="0"
                required
                className="font-data"
              />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Source & supervisors">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="Source location" htmlFor="sourceLocation" className="md:col-span-2">
              <Input
                id="sourceLocation"
                type="text"
                name="sourceLocation"
                value={formData.sourceLocation}
                onChange={handleChange}
              />
            </Field>
            <Field label="Transfer supervisor" htmlFor="transferSupervisor">
              <Input
                id="transferSupervisor"
                type="text"
                name="transferSupervisor"
                value={formData.transferSupervisor}
                onChange={handleChange}
              />
            </Field>
            <Field label="Sampling supervisor" htmlFor="samplingSupervisor">
              <Input
                id="samplingSupervisor"
                type="text"
                name="samplingSupervisor"
                value={formData.samplingSupervisor}
                onChange={handleChange}
              />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Notes">
          <Field label="Optional notes" htmlFor="notes">
            <Textarea
              id="notes"
              name="notes"
              value={formData.notes}
              onChange={handleChange}
            />
          </Field>
        </FormSection>

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
