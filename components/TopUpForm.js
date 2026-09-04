import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { useQuery } from 'convex/react'
import { AlertCircle } from 'lucide-react'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import stockingService from '../lib/stockingService'
import { useToast } from './Toast'
import DependencyEmpty from './DependencyEmpty'
import PersonPicker from './PersonPicker'
import FarmLocationSelect from './FarmLocationSelect'
import { usePersistedForm } from '../hooks/usePersistedForm'
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

const TOPUP_DEFAULTS = {
  stocking_id: '',
  topup_date: new Date().toISOString().split('T')[0],
  fish_count: '',
  abw: '',
  source_location: '',
  transfer_supervisor: '',
  notes: '',
}

const TopUpForm = ({ onComplete }) => {
  const router = useRouter()
  const { user } = useAuth()
  const { showToast } = useToast()
  const settingsData = useQuery(api.companies.getEffectiveSettings)
  const rules = settingsData?.settings

  const [loading, setLoading] = useState(false)
  const [fetchingData, setFetchingData] = useState(true)
  const [activeStockings, setActiveStockings] = useState([])
  const [error, setError] = useState('')
  const [selectedStocking, setSelectedStocking] = useState(null)
  const [warn, setWarn] = useState([])
  const { formData, handleChange, clear, setFormData } = usePersistedForm(
    'topup-create',
    TOPUP_DEFAULTS,
  )

  useEffect(() => {
    async function fetchStockings() {
      setFetchingData(true)
      try {
        const { data, error: fetchError } = await stockingService.getActiveStockings()
        if (fetchError) throw fetchError
        setActiveStockings(data || [])
      } catch (err) {
        console.error('Error fetching active stockings:', err)
        setError('Failed to load active stockings. Please try again.')
        showToast('error', 'Failed to load active stockings')
      } finally {
        setFetchingData(false)
      }
    }

    fetchStockings()
  }, [showToast])

  useEffect(() => {
    async function fetchStockingDetails(id) {
      try {
        const { data, error: fetchError } = await stockingService.getStockingById(id)
        if (fetchError) throw fetchError
        setSelectedStocking(data)
      } catch (err) {
        console.error('Error fetching stocking details:', err)
        setError('Failed to load stocking details')
        showToast('error', 'Failed to load stocking details')
      }
    }

    if (formData.stocking_id) {
      fetchStockingDetails(formData.stocking_id)
    } else {
      setSelectedStocking(null)
    }
  }, [formData.stocking_id, showToast])

  useEffect(() => {
    if (!rules) return
    const notes = []
    const abw = Number(formData.abw)
    const sr = rules.stockingRules
    const minAbw = sr.minTopupAbwG ?? 5
    const maxAbw = sr.maxTopupAbwG ?? 800
    if (abw && (abw < minAbw || abw > maxAbw)) {
      notes.push(`ABW should be ${minAbw}–${maxAbw}g`)
    }
    if (sr.requireApprovalForTopup) {
      notes.push('This top-up will require admin approval')
    }
    setWarn(notes)
  }, [formData.abw, rules])

  const calculateBiomass = () => {
    if (!formData.fish_count || !formData.abw) return 0
    const count = parseFloat(formData.fish_count)
    const abw = parseFloat(formData.abw)
    if (isNaN(count) || isNaN(abw)) return 0
    return (abw / 1000) * count
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      if (!formData.stocking_id) {
        throw new Error('Please select a batch to top up')
      }
      if (!formData.fish_count || parseInt(formData.fish_count, 10) <= 0) {
        throw new Error('Please enter a valid fish count')
      }
      if (!formData.abw || parseFloat(formData.abw) <= 0) {
        throw new Error('Please enter a valid average body weight')
      }

      const data = {
        ...formData,
        company_id: user?.company_id || '00000000-0000-0000-0000-000000000001',
        created_by: user?.id,
      }

      const { data: result, error: createError } = await stockingService.createTopUp(data)
      if (createError) throw createError

      showToast(
        'success',
        'Top-up request submitted successfully. Awaiting approval.',
      )

      clear()
      setFormData({
        ...TOPUP_DEFAULTS,
        topup_date: new Date().toISOString().split('T')[0],
      })

      if (onComplete) {
        onComplete(result)
      } else {
        router.push('/stocking-management')
      }
    } catch (err) {
      console.error('Error creating top-up:', err)
      setError(err.message)
      showToast('error', err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <FormCard
      title="Top-up details"
      subtitle="Add fish to an existing active batch. Drafts survive a refresh."
    >
      {error && (
        <div className="mb-5 text-sm text-signal border border-signal/20 bg-signal/10 rounded-xl p-3 flex items-start gap-2">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <span>{error}</span>
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
        <FormSection title="Batch">
          <Field label="Select batch to top-up" htmlFor="stocking_id" required>
            {fetchingData ? (
              <div className="flex items-center gap-2 min-h-12 text-sm text-muted">
                <div className="w-4 h-4 border-2 border-lagoon-800 border-t-transparent rounded-full animate-spin" />
                Loading batches…
              </div>
            ) : (
              <Select
                id="stocking_id"
                name="stocking_id"
                value={formData.stocking_id}
                onChange={handleChange}
                required
                disabled={activeStockings.length === 0}
              >
                <option value="">Select a batch</option>
                {activeStockings.map((stocking) => (
                  <option key={stocking.id} value={stocking.id}>
                    {stocking.batch_number} — {stocking.cage?.name} — Stocked:{' '}
                    {new Date(stocking.stocking_date).toLocaleDateString()}
                  </option>
                ))}
              </Select>
            )}
            {activeStockings.length === 0 && !fetchingData && (
              <DependencyEmpty
                message="Top-up needs an approved active stocking. Stock a cage first, or check pending approvals."
                createKind="stocking"
                createLabel="Create stocking"
                secondaryHref="/approvals"
                secondaryLabel="View approvals"
                onCreated={async (result) => {
                  setFetchingData(true)
                  try {
                    const { data, error: fetchError } =
                      await stockingService.getActiveStockings()
                    if (fetchError) throw fetchError
                    setActiveStockings(data || [])
                    if (result?.id) {
                      setFormData((prev) => ({
                        ...prev,
                        stocking_id: result.id,
                      }))
                    }
                    showToast(
                      'success',
                      'Stocking created. If it needs approval, it will appear here after approval.',
                    )
                  } catch (err) {
                    showToast('error', err.message || 'Failed to refresh batches')
                  } finally {
                    setFetchingData(false)
                  }
                }}
              />
            )}
          </Field>

          {selectedStocking && (
            <div className="mt-4 rounded-xl border border-foam-deep bg-foam p-4">
              <h4 className="text-sm font-semibold text-chart-ink mb-3">
                Current batch
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <span className="text-muted">Count</span>
                  <p className="font-data font-semibold text-chart-ink">
                    {selectedStocking.fish_count.toLocaleString()} fish
                  </p>
                </div>
                <div>
                  <span className="text-muted">Initial ABW</span>
                  <p className="font-data font-semibold text-chart-ink">
                    {selectedStocking.initial_abw.toFixed(1)} g
                  </p>
                </div>
                <div>
                  <span className="text-muted">Initial biomass</span>
                  <p className="font-data font-semibold text-chart-ink">
                    {selectedStocking.initial_biomass.toFixed(1)} kg
                  </p>
                </div>
              </div>
              {selectedStocking.topups?.length > 0 && (
                <p className="mt-3 text-sm text-muted">
                  Previous top-ups: {selectedStocking.topups.length} (
                  {selectedStocking.topups
                    .reduce((sum, t) => sum + t.fish_count, 0)
                    .toLocaleString()}{' '}
                  fish)
                </p>
              )}
            </div>
          )}
        </FormSection>

        <FormSection title="Fish to add">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="Top-up date" htmlFor="topup_date" required>
              <Input
                id="topup_date"
                type="date"
                name="topup_date"
                value={formData.topup_date}
                onChange={handleChange}
                required
              />
            </Field>
            <Field label="Fish count to add" htmlFor="fish_count" required>
              <Input
                id="fish_count"
                type="number"
                name="fish_count"
                value={formData.fish_count}
                onChange={handleChange}
                min="1"
                required
                className="font-data"
                placeholder="Number of fish to add"
              />
            </Field>
            <Field
              label="Average body weight (g)"
              htmlFor="abw"
              required
              hint={
                rules?.stockingRules
                  ? `Allowed ${rules.stockingRules.minTopupAbwG ?? 5}–${rules.stockingRules.maxTopupAbwG ?? 800}g (culture size, not fingerling-only)`
                  : undefined
              }
            >
              <Input
                id="abw"
                type="number"
                name="abw"
                value={formData.abw}
                onChange={handleChange}
                step="0.1"
                min="0.1"
                required
                className="font-data"
                placeholder="ABW in grams"
              />
            </Field>
            <Field
              label="Biomass to add (kg)"
              htmlFor="biomass"
              hint="Auto-calculated: (ABW ÷ 1000) × fish count"
            >
              <Input
                id="biomass"
                type="text"
                value={calculateBiomass().toFixed(2)}
                readOnly
                className="font-data bg-foam"
              />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Source & notes">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field
              label="Source location"
              htmlFor="source_location"
              hint="Defaults to header location"
            >
              <FarmLocationSelect
                id="source_location"
                name="source_location"
                value={formData.source_location}
                onChange={handleChange}
                valueKind="name"
              />
            </Field>
            <Field
              label="Transfer supervisor"
              htmlFor="transfer_supervisor"
              hint="Pick a user or type a name"
            >
              <PersonPicker
                id="transfer_supervisor"
                name="transfer_supervisor"
                value={formData.transfer_supervisor}
                onChange={handleChange}
                placeholder="Person who supervised the transfer"
              />
            </Field>
            <Field label="Notes" htmlFor="notes" className="md:col-span-2">
              <Textarea
                id="notes"
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                placeholder="Any additional information about this top-up"
              />
            </Field>
          </div>
        </FormSection>

        <FormActions>
          <Button
            type="submit"
            disabled={loading || fetchingData || activeStockings.length === 0}
            size="lg"
          >
            {loading ? 'Submitting…' : 'Submit top-up'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => router.push('/stocking-management')}
          >
            Cancel
          </Button>
        </FormActions>
      </form>
    </FormCard>
  )
}

export default TopUpForm
