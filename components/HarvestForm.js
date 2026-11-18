import React, { useState, useEffect } from 'react'
import { harvestRecordService, cageService } from '../lib/databaseService'
import { getConvexHttpClient, api } from '../lib/convexBridge'
import { useToast } from './Toast'
import DependencyEmpty from './DependencyEmpty'
import LocationMetaField from './LocationMetaField'
import { usePersistedForm } from '../hooks/usePersistedForm'
import { useOnline } from '../hooks/useOutbox'
import { useAuth } from '../contexts/AuthContext'
import { cleanError } from '../lib/offlineOutbox'
import { saveOrQueue } from '../lib/outboxSenders'
import OutboxPanel from './OutboxPanel'
import {
  Button,
  Card,
  Field,
  FormActions,
  FormSection,
  Input,
  Select,
  Textarea,
} from './ui'
import { localToday } from '../lib/format'

const SIZE_CATEGORIES = [
  { category: 'S3', range: '800g above' },
  { category: 'S2', range: '700g-800g' },
  { category: 'S1', range: '600g-700g' },
  { category: 'Reg', range: '500g-600g' },
  { category: 'Eco', range: '400g-500g' },
  { category: 'SS', range: '300g-400g' },
  { category: 'SB', range: '200g-300g' },
  { category: 'Rej', range: 'less than 200g' },
]

const HARVEST_DEFAULTS = {
  harvestDate: localToday(),
  cageId: '',
  harvestType: 'complete',
  totalWeight: '',
  averageBodyWeight: '',
  estimatedCount: '',
  fcr: '',
  sizeBreakdown: SIZE_CATEGORIES.map((category) => ({
    category: category.category,
    range: category.range,
    weight: '',
  })),
  notes: '',
}

const HarvestForm = ({ onComplete }) => {
  const { formData, setFormData, handleChange, clear } = usePersistedForm(
    'harvest-create',
    HARVEST_DEFAULTS,
  )
  const [loading, setLoading] = useState(false)
  const [cages, setCages] = useState([])
  const [cagesReady, setCagesReady] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [fcrCalc, setFcrCalc] = useState(null)
  const [fcrTouched, setFcrTouched] = useState(false)
  const { showToast } = useToast()
  const { user } = useAuth()
  const online = useOnline()

  useEffect(() => {
    const fetchCages = async () => {
      try {
        const { data, error } = await cageService.getActiveCages()
        if (error) throw error
        setCages(data || [])
      } catch (error) {
        // No signal: the cage list daily entry saved on this device last time.
        let cached = null
        try {
          cached = JSON.parse(localStorage.getItem('pbafarm:daily-entry:lookups') || 'null')
        } catch {
          cached = null
        }
        if (cached?.cages) {
          setCages(cached.cages)
        } else {
          console.error('Error fetching cages:', error)
          showToast('Error fetching cages', 'error')
        }
      } finally {
        setCagesReady(true)
      }
    }

    fetchCages()
  }, [showToast])

  // Work out FCR from the feed logged since stocking once cage, date and weight are known.
  useEffect(() => {
    const weight = parseFloat(formData.totalWeight)
    if (!formData.cageId || !formData.harvestDate || !(weight > 0)) {
      setFcrCalc(null)
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const res = await getConvexHttpClient().query(api.harvest.suggestFcr, {
          cageId: formData.cageId,
          harvestDate: formData.harvestDate,
          totalWeight: weight,
        })
        if (cancelled) return
        setFcrCalc(res)
        if (res?.fcr != null && !fcrTouched) {
          setFormData((prev) => ({ ...prev, fcr: String(res.fcr) }))
        }
      } catch {
        if (!cancelled) setFcrCalc(null)
      }
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.cageId, formData.harvestDate, formData.totalWeight])

  const handleSizeBreakdownChange = (index, value) => {
    const newSizeBreakdown = [...(formData.sizeBreakdown || [])]
    newSizeBreakdown[index] = { ...newSizeBreakdown[index], weight: value }
    setFormData((prev) => ({ ...prev, sizeBreakdown: newSizeBreakdown }))
  }

  const calculateTotalWeight = () => {
    return (formData.sizeBreakdown || []).reduce((sum, size) => {
      return sum + (parseFloat(size.weight) || 0)
    }, 0)
  }

  const num = (v) => (v === '' || v == null ? null : Number(v))

  // Size grades are optional: blanks count as 0. Missing totals are filled in
  // where they can be worked out, and every problem is named in one message.
  const validateForm = () => {
    const problems = []
    const next = {}
    if (!formData.cageId || !cages.some((c) => (c.id || c._id) === formData.cageId)) {
      problems.push('pick a cage')
    }
    if (!formData.harvestDate) problems.push('set the harvest date')

    const badGrade = (formData.sizeBreakdown || []).find((s) => {
      const n = num(s.weight)
      return n != null && (!Number.isFinite(n) || n < 0)
    })
    if (badGrade) problems.push(`fix the ${badGrade.category} weight`)
    const gradeSum = calculateTotalWeight()

    let total = num(formData.totalWeight)
    if (total == null && gradeSum > 0) {
      total = Math.round(gradeSum * 100) / 100
      next.totalWeight = String(total)
    }
    const abw = num(formData.averageBodyWeight)
    let count = num(formData.estimatedCount)
    if (count == null && total > 0 && abw > 0) {
      count = Math.round((total * 1000) / abw)
      next.estimatedCount = String(count)
    }
    let fcrVal = num(formData.fcr)
    if (fcrVal == null && fcrCalc?.fcr != null) {
      fcrVal = fcrCalc.fcr
      next.fcr = String(fcrVal)
    }

    if (!(total > 0)) problems.push('enter the total weight (or the size grades)')
    if (!(abw > 0)) problems.push('enter the average body weight')
    if (!(count > 0)) problems.push('enter the fish count')
    if (!(fcrVal > 0)) {
      problems.push(
        fcrCalc && fcrCalc.fcr == null
          ? 'enter the FCR (not enough feed logged to calculate it)'
          : 'enter the FCR',
      )
    }
    if (total > 0 && gradeSum > 0 && Math.abs(gradeSum - total) > 0.5) {
      problems.push(
        `size grades add up to ${gradeSum.toLocaleString()} kg but total weight is ${total.toLocaleString()} kg`,
      )
    }

    if (Object.keys(next).length) setFormData((prev) => ({ ...prev, ...next }))
    if (problems.length) {
      const msg = problems.join(', ')
      showToast(msg.charAt(0).toUpperCase() + msg.slice(1), 'error')
      return false
    }
    return true
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validateForm()) return
    setShowPreview(true)
  }

  const handleConfirmSave = async () => {
    setLoading(true)
    try {
      const harvestData = {
        cage_id: formData.cageId,
        harvest_date: formData.harvestDate,
        harvest_type: formData.harvestType,
        status: formData.harvestType === 'complete' ? 'completed' : 'in_progress',
        total_weight: parseFloat(formData.totalWeight),
        average_body_weight: parseFloat(formData.averageBodyWeight),
        estimated_count: parseInt(formData.estimatedCount, 10),
        fcr: parseFloat(formData.fcr),
        size_breakdown: (formData.sizeBreakdown || []).map((size) => ({
          category: size.category,
          range: size.range,
          weight: parseFloat(size.weight) || 0,
        })),
        notes: formData.notes,
      }

      const { error, warnings, queued } = await saveOrQueue({
        kind: 'harvest',
        payload: JSON.parse(JSON.stringify(harvestData)),
        summary: `${formData.harvestDate} · ${selectedCageObject?.name || 'Cage'} · ${
          harvestData.total_weight
        } kg ${formData.harvestType}`,
        userId: user?.id,
      })
      if (error) throw error

      showToast(
        queued
          ? 'No connection. Harvest saved on this device and will send when you are back online'
          : formData.harvestType === 'complete'
          ? `Harvest saved. ${selectedCageObject?.name || 'The cage'} is now marked harvested`
          : 'Partial harvest saved. Fish taken off the cage count',
        'success',
      )
      if (warnings?.length) showToast(warnings.join('. '), 'warning')
      clear()
      setFormData({
        ...HARVEST_DEFAULTS,
        harvestDate: localToday(),
        sizeBreakdown: SIZE_CATEGORIES.map((category) => ({
          category: category.category,
          range: category.range,
          weight: '',
        })),
      })
      setShowPreview(false)
      setLoading(false)
      if (onComplete) onComplete()
    } catch (error) {
      console.error('Error saving harvest record:', error)
      showToast(cleanError(error) || 'Error saving harvest record', 'error')
      setLoading(false)
      setShowPreview(false)
    }
  }

  const handleEdit = () => {
    setShowPreview(false)
  }

  const selectedCageObject = cages.find(
    (cage) => (cage.id || cage._id) === formData.cageId,
  )

  const calculateDoc = () => {
    if (!selectedCageObject || !selectedCageObject.stocking_date || !formData.harvestDate) {
      return 'N/A'
    }
    const stockingDate = new Date(selectedCageObject.stocking_date)
    const harvestDate = new Date(formData.harvestDate)
    const timeDiff = harvestDate.getTime() - stockingDate.getTime()
    const dayDiff = Math.ceil(timeDiff / (1000 * 3600 * 24))
    return dayDiff >= 0 ? dayDiff : 'N/A'
  }

  const cageDoc = calculateDoc()
  const sizeBreakdown =
    formData.sizeBreakdown?.length > 0
      ? formData.sizeBreakdown
      : HARVEST_DEFAULTS.sizeBreakdown

  const previewRow = (label, value) => (
    <div className="flex justify-between gap-4 py-2 border-b border-foam-deep text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-chart-ink tabular-nums text-right">{value}</dd>
    </div>
  )

  return (
    <Card>
      <OutboxPanel compact online={online} kinds={['harvest']} />
      {!showPreview ? (
        <form onSubmit={handleSubmit} noValidate className="space-y-8">
          <FormSection
            title="Harvest details"
            description="Drafts survive a browser refresh."
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <LocationMetaField />
              </div>
              <Field label="Cage" htmlFor="harvest-cage" required>
                <Select
                  id="harvest-cage"
                  name="cageId"
                  value={formData.cageId}
                  onChange={handleChange}
                  required
                  disabled={cagesReady && cages.length === 0}
                >
                  <option value="">
                    {cagesReady && cages.length === 0
                      ? 'No active cages available'
                      : 'Select a cage'}
                  </option>
                  {cages.map((cage) => (
                    <option key={cage.id || cage._id} value={cage.id || cage._id}>
                      {cage.name}
                    </option>
                  ))}
                </Select>
                {cagesReady && cages.length === 0 && (
                  <DependencyEmpty
                    message="Harvest needs an active cage with fish. Stock a cage first (approve if required)."
                    createKind="stocking"
                    createLabel="Create stocking"
                    secondaryCreateKind="cage"
                    secondaryCreateLabel="Create a cage"
                    onCreated={async () => {
                      try {
                        const { data, error } = await cageService.getActiveCages()
                        if (error) throw error
                        setCages(data || [])
                        showToast(
                          'If stocking needs approval, the cage appears here after approval.',
                          'success',
                        )
                      } catch (err) {
                        showToast(err.message || 'Failed to refresh cages', 'error')
                      }
                    }}
                  />
                )}
              </Field>

              <Field label="Harvest date" htmlFor="harvest-date" required>
                <Input
                  id="harvest-date"
                  type="date"
                  name="harvestDate"
                  value={formData.harvestDate}
                  onChange={handleChange}
                  required
                />
              </Field>

              <Field label="Harvest type" htmlFor="harvest-type" required>
                <Select
                  id="harvest-type"
                  name="harvestType"
                  value={formData.harvestType}
                  onChange={handleChange}
                  required
                >
                  <option value="complete">Complete harvest</option>
                  <option value="partial">Partial harvest</option>
                </Select>
              </Field>

              <Field label="Total weight (kg)" htmlFor="harvest-total" required>
                <Input
                  id="harvest-total"
                  type="number"
                  name="totalWeight"
                  value={formData.totalWeight}
                  onChange={handleChange}
                  step="0.01"
                  className="tabular-nums"
                  required
                />
              </Field>

              <Field label="Average body weight (g)" htmlFor="harvest-abw" required>
                <Input
                  id="harvest-abw"
                  type="number"
                  name="averageBodyWeight"
                  value={formData.averageBodyWeight}
                  onChange={handleChange}
                  step="0.01"
                  className="tabular-nums"
                  required
                />
              </Field>

              <Field label="Estimated count" htmlFor="harvest-count" required>
                <Input
                  id="harvest-count"
                  type="number"
                  name="estimatedCount"
                  value={formData.estimatedCount}
                  onChange={handleChange}
                  className="tabular-nums"
                  required
                />
              </Field>

              <Field label="FCR (feed conversion ratio)" htmlFor="harvest-fcr" required>
                <Input
                  id="harvest-fcr"
                  type="number"
                  name="fcr"
                  value={formData.fcr}
                  onChange={(e) => {
                    setFcrTouched(true)
                    handleChange(e)
                  }}
                  step="0.01"
                  className="tabular-nums"
                  required
                />
                {fcrCalc && (
                  <p className="text-xs text-muted tabular-nums">
                    {fcrCalc.fcr != null
                      ? `Calculated ${fcrCalc.fcr.toFixed(2)}: ${Number(fcrCalc.feed_kg).toLocaleString()} kg feed since ${fcrCalc.stocking_date}, ${Number(fcrCalc.stocked_biomass_kg || 0).toLocaleString()} kg stocked`
                      : 'Not enough feed or growth logged to calculate FCR. Enter it by hand'}
                    {fcrCalc.fcr != null && fcrTouched && Number(formData.fcr) !== fcrCalc.fcr && (
                      <>
                        {' '}
                        <button
                          type="button"
                          className="text-lake underline underline-offset-2"
                          onClick={() => {
                            setFcrTouched(false)
                            setFormData((prev) => ({ ...prev, fcr: String(fcrCalc.fcr) }))
                          }}
                        >
                          Use calculated
                        </button>
                      </>
                    )}
                  </p>
                )}
              </Field>
            </div>
          </FormSection>

          <FormSection title="Size breakdown (kg)">
            <p className="text-xs text-muted -mt-2 tabular-nums">
              Optional. Leave grades you didn&apos;t sort blank.
              {calculateTotalWeight() > 0 &&
                ` Grades add up to ${calculateTotalWeight().toLocaleString()} kg${
                  formData.totalWeight ? '' : ', used as the total weight'
                }.`}
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {sizeBreakdown.map((size, index) => (
                <Field
                  key={size.category}
                  label={`${size.category} (${size.range})`}
                  htmlFor={`harvest-grade-${size.category}`}
                >
                  <Input
                    id={`harvest-grade-${size.category}`}
                    type="number"
                    value={size.weight}
                    onChange={(e) => handleSizeBreakdownChange(index, e.target.value)}
                    step="0.01"
                    min="0"
                    inputMode="decimal"
                    placeholder="0"
                    className="tabular-nums"
                  />
                </Field>
              ))}
            </div>
          </FormSection>

          <Field label="Notes" htmlFor="harvest-notes">
            <Textarea
              id="harvest-notes"
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows={3}
              placeholder="Optional notes about the harvest"
            />
          </Field>

          <FormActions className="justify-end">
            <Button type="button" variant="secondary" onClick={() => onComplete()}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || cages.length === 0}>
              Review harvest
            </Button>
          </FormActions>
        </form>
      ) : (
        <div className="space-y-6">
          <h3 className="font-display text-lg font-medium text-chart-ink">
            Check the harvest before saving
          </h3>

          <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-8">
            {previewRow('Cage', selectedCageObject?.name || 'N/A')}
            {previewRow('Harvest date', formData.harvestDate)}
            {selectedCageObject?.stocking_date &&
              previewRow('Stocking date', selectedCageObject.stocking_date)}
            {previewRow('Days of culture (DOC)', cageDoc)}
            {previewRow(
              'Harvest type',
              formData.harvestType === 'complete' ? 'Complete harvest' : 'Partial harvest',
            )}
            {previewRow('Total weight', `${formData.totalWeight} kg`)}
            {previewRow('Average body weight', `${formData.averageBodyWeight} g`)}
            {previewRow('Estimated count', formData.estimatedCount)}
            {previewRow('FCR', formData.fcr)}
          </dl>

          <p className="rounded-lg border border-foam-deep bg-foam p-3 text-sm text-chart-ink tabular-nums">
            {formData.harvestType === 'complete'
              ? `Saving empties ${selectedCageObject?.name || 'this cage'}: its fish count goes to 0, it is marked harvested and its stocking cycle closes.`
              : `Saving takes ${Number(formData.estimatedCount || 0).toLocaleString()} fish off ${selectedCageObject?.name || 'this cage'}'s count.`}
            {selectedCageObject?.current_count != null &&
              ` On record now: ${Number(selectedCageObject.current_count).toLocaleString()} fish.`}
          </p>

          <div>
            <h4 className="text-base font-medium text-chart-ink mb-3">Size breakdown (kg)</h4>
            <ul className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {sizeBreakdown.map((size) => (
                <li
                  key={size.category}
                  className="rounded-lg border border-foam-deep bg-foam p-3 text-sm text-chart-ink"
                >
                  <span className="text-muted">
                    {size.category} ({size.range})
                  </span>
                  <span className="block font-medium tabular-nums">
                    {size.weight || '0'} kg
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {formData.notes && (
            <div>
              <h4 className="text-base font-medium text-chart-ink mb-2">Notes</h4>
              <p className="text-sm text-chart-ink bg-foam p-3 rounded-lg">
                {formData.notes}
              </p>
            </div>
          )}

          <FormActions className="justify-end">
            <Button type="button" variant="secondary" onClick={handleEdit}>
              Edit
            </Button>
            <Button type="button" onClick={handleConfirmSave} disabled={loading}>
              {loading ? 'Saving…' : 'Save harvest'}
            </Button>
          </FormActions>
        </div>
      )}
    </Card>
  )
}

export default HarvestForm
