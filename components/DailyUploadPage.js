import React, { useState, useEffect } from 'react'
import { cageService } from '../lib/cageService'
import { feedTypeService } from '../lib/feedTypeService'
import { dailyRecordService } from '../lib/databaseService'
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
import { useToast } from './Toast'
import { usePersistedForm } from '../hooks/usePersistedForm'
import { useAuth } from '../contexts/AuthContext'
import { MORTALITY_CAUSES } from '../lib/farmHealth'

const DEFAULTS = {
  selectedCage: '',
  date: new Date().toISOString().split('T')[0],
  mortalityCount: 0,
  mortalityCause: 'unknown',
  feedAmount: 0,
  feedTypeId: '',
  feedPrice: 0,
  notes: '',
  allowNegative: false,
  overrideReason: '',
}

const DailyUploadPage = () => {
  const [cages, setCages] = useState([])
  const [feedTypes, setFeedTypes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [lookupsReady, setLookupsReady] = useState(false)
  const { showToast } = useToast()
  const { hasRole } = useAuth()
  const { formData, setFormData, handleChange, clear } = usePersistedForm(
    'daily-entry',
    DEFAULTS,
  )

  useEffect(() => {
    loadLookups()
  }, [])

  const loadLookups = async () => {
    try {
      const [cageRes, feedRes] = await Promise.all([
        cageService.getActiveCages(),
        feedTypeService.getAllFeedTypes(),
      ])
      if (cageRes.data) setCages(cageRes.data)
      if (feedRes.data) {
        setFeedTypes(
          (feedRes.data || []).filter((f) => f.active !== false && !f.deleted_at),
        )
      }
    } catch (err) {
      console.error('Error loading lookups:', err)
    } finally {
      setLookupsReady(true)
    }
  }

  const selectedFeed = feedTypes.find(
    (f) => (f.id || f._id) === formData.feedTypeId,
  )
  const feedAmount = Number(formData.feedAmount) || 0
  const stockOnHand = Number(selectedFeed?.current_stock ?? 0)
  const stockShort =
    Boolean(formData.feedTypeId) && feedAmount > 0 && stockOnHand < feedAmount
  const isInsufficientError = /insufficient stock/i.test(error || '')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!formData.selectedCage) {
      setError('Please select a cage')
      return
    }
    if (feedAmount > 0 && !formData.feedTypeId) {
      setError('Feed type is required when feed amount > 0')
      return
    }
    if (stockShort && !(hasRole('admin') && formData.allowNegative)) {
      setError(
        `Insufficient stock for ${selectedFeed?.name || 'feed'}: have ${stockOnHand} kg, need ${feedAmount} kg. Record a purchase first.`,
      )
      return
    }
    if (formData.allowNegative && !String(formData.overrideReason || '').trim()) {
      setError('Admin override requires a reason')
      return
    }

    setLoading(true)
    try {
      const feedPrice =
        Number(formData.feedPrice) ||
        Number(selectedFeed?.price_per_kg || selectedFeed?.pricePerKg || 0)

      const response = await dailyRecordService.createDailyRecord({
        cage_id: formData.selectedCage,
        cageId: formData.selectedCage,
        date: formData.date,
        feed_amount: feedAmount,
        feedAmount,
        feed_type_id: formData.feedTypeId || undefined,
        feedTypeId: formData.feedTypeId || undefined,
        feed_price: feedPrice,
        feedPrice,
        feed_cost: feedAmount * feedPrice,
        feedCost: feedAmount * feedPrice,
        mortality: Number(formData.mortalityCount) || 0,
        mortalityCause:
          Number(formData.mortalityCount) > 0
            ? formData.mortalityCause || 'unknown'
            : undefined,
        notes: formData.notes || undefined,
        allowNegative: formData.allowNegative === true,
        overrideReason: formData.overrideReason || undefined,
      })

      if (response.error) throw response.error

      clear()
      setFormData({
        ...DEFAULTS,
        date: new Date().toISOString().split('T')[0],
      })
      showToast('Daily record created — stock updated on ledger', 'success')
      loadLookups()
    } catch (err) {
      console.error('Error creating daily record:', err)
      setError(err.message || 'Error creating daily record')
      showToast(err.message || 'Error creating daily record', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <FormCard
      title="Record details"
      subtitle="Choose a cage, then log mortality and feed for the day. Drafts are kept if you refresh."
    >
      {error && (
        <div className="mb-5 text-sm text-signal border border-signal/20 bg-signal/10 rounded-xl p-3">
          {error}
          {(isInsufficientError || stockShort) && (
            <DependencyEmpty
              className="mt-3 border-signal/20 bg-white/60"
              message="Add stock via a purchase, then save this daily entry again."
              createKind="purchase"
              createLabel="Record a purchase"
              createProps={{ defaultFeedTypeId: formData.feedTypeId }}
              onCreated={() => {
                setError('')
                loadLookups()
                showToast('Purchase recorded — stock updated', 'success')
              }}
            />
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-8">
        <FormSection title="Cage & date">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="Cage" htmlFor="selectedCage" required className="md:col-span-2">
              <Select
                id="selectedCage"
                name="selectedCage"
                value={formData.selectedCage}
                onChange={handleChange}
                required
                disabled={lookupsReady && cages.length === 0}
              >
                <option value="">
                  {lookupsReady && cages.length === 0
                    ? 'No active cages available'
                    : 'Choose a cage…'}
                </option>
                {cages.map((cage) => (
                  <option key={cage._id || cage.id} value={cage._id || cage.id}>
                    {cage.name} — {cage.status}
                  </option>
                ))}
              </Select>
              {lookupsReady && cages.length === 0 && (
                <DependencyEmpty
                  message="Daily entry needs an active cage. Create a cage, then stock it (and approve if required) so the cage becomes active."
                  createKind="cage"
                  createLabel="Create a cage"
                  secondaryCreateKind="stocking"
                  secondaryCreateLabel="Stock a cage"
                  onCreated={(result) => {
                    loadLookups()
                    if (result?.kind === 'stocking') {
                      showToast(
                        'Stocking created. After approval (if required), the cage will appear here.',
                        'success',
                      )
                    }
                  }}
                />
              )}
            </Field>
            <Field label="Date" htmlFor="date" required>
              <Input
                id="date"
                type="date"
                name="date"
                value={formData.date}
                onChange={handleChange}
                required
              />
            </Field>
            <Field
              label="Mortality"
              htmlFor="mortalityCount"
              hint="Number of fish lost today"
            >
              <Input
                id="mortalityCount"
                type="number"
                name="mortalityCount"
                value={formData.mortalityCount}
                onChange={handleChange}
                min="0"
                className="font-data"
              />
            </Field>
            {Number(formData.mortalityCount) > 0 && (
              <Field label="Mortality cause" htmlFor="mortalityCause">
                <Select
                  id="mortalityCause"
                  name="mortalityCause"
                  value={formData.mortalityCause || 'unknown'}
                  onChange={handleChange}
                >
                  {MORTALITY_CAUSES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </div>
        </FormSection>

        <FormSection
          title="Feed"
          description="Feed amounts deduct stock through the inventory ledger."
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Field label="Feed type" htmlFor="feedTypeId">
              <Select
                id="feedTypeId"
                name="feedTypeId"
                value={formData.feedTypeId}
                onChange={handleChange}
                disabled={lookupsReady && feedTypes.length === 0}
              >
                <option value="">
                  {lookupsReady && feedTypes.length === 0
                    ? 'No feed types available'
                    : 'Select…'}
                </option>
                {feedTypes.map((f) => (
                  <option key={f.id || f._id} value={f.id || f._id}>
                    {f.name} ({Number(f.current_stock || 0).toFixed(1)} kg)
                  </option>
                ))}
              </Select>
              {lookupsReady && feedTypes.length === 0 && (
                <DependencyEmpty
                  message="Add a feed type before recording feed amounts. Purchases can then add stock to that type."
                  createKind="feedType"
                  createLabel="Create feed type"
                  secondaryCreateKind="purchase"
                  secondaryCreateLabel="Record a purchase"
                  onCreated={(result) => {
                    loadLookups()
                    if (result?.kind === 'feedType' && result.id) {
                      setFormData((prev) => ({
                        ...prev,
                        feedTypeId: result.id,
                      }))
                    }
                  }}
                />
              )}
            </Field>
            <Field
              label="Feed amount (kg)"
              htmlFor="feedAmount"
              hint={
                selectedFeed
                  ? `On hand: ${stockOnHand.toFixed(1)} kg`
                  : undefined
              }
            >
              <Input
                id="feedAmount"
                type="number"
                name="feedAmount"
                step="0.1"
                value={formData.feedAmount}
                onChange={handleChange}
                min="0"
                className="font-data"
              />
            </Field>
          </div>

          {stockShort && (
            <DependencyEmpty
              message={`Not enough stock to save ${feedAmount} kg of ${selectedFeed?.name || 'feed'} (have ${stockOnHand} kg). Record a purchase first.`}
              createKind="purchase"
              createLabel="Record a purchase"
              createProps={{ defaultFeedTypeId: formData.feedTypeId }}
              onCreated={() => {
                setError('')
                loadLookups()
                showToast('Purchase recorded — stock updated', 'success')
              }}
            />
          )}

          {hasRole('admin') && stockShort && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-chart-ink">
                <input
                  type="checkbox"
                  name="allowNegative"
                  checked={Boolean(formData.allowNegative)}
                  onChange={handleChange}
                  className="rounded border-zinc-300"
                />
                Admin override (allow insufficient stock)
              </label>
              {formData.allowNegative && (
                <Field label="Override reason" htmlFor="overrideReason" required>
                  <Input
                    id="overrideReason"
                    name="overrideReason"
                    value={formData.overrideReason || ''}
                    onChange={handleChange}
                    required
                    placeholder="Why is this override needed?"
                  />
                </Field>
              )}
            </div>
          )}
        </FormSection>

        <FormSection title="Notes">
          <Field label="Optional notes" htmlFor="notes">
            <Textarea
              id="notes"
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              placeholder="Observations, weather, unusual events…"
            />
          </Field>
        </FormSection>

        <FormActions>
          <Button
            type="submit"
            disabled={
              loading ||
              cages.length === 0 ||
              (stockShort && !(hasRole('admin') && formData.allowNegative))
            }
            size="lg"
          >
            {loading ? 'Saving…' : 'Save daily record'}
          </Button>
        </FormActions>
      </form>
    </FormCard>
  )
}

export default DailyUploadPage
