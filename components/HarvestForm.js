import React, { useState, useEffect } from 'react'
import { harvestRecordService, cageService } from '../lib/databaseService'
import { getConvexHttpClient, api } from '../lib/convexBridge'
import { useToast } from './Toast'
import DependencyEmpty from './DependencyEmpty'
import LocationMetaField from './LocationMetaField'
import { usePersistedForm } from '../hooks/usePersistedForm'

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
  harvestDate: new Date().toISOString().split('T')[0],
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

  useEffect(() => {
    const fetchCages = async () => {
      try {
        const { data, error } = await cageService.getActiveCages()
        if (error) throw error
        setCages(data || [])
      } catch (error) {
        console.error('Error fetching cages:', error)
        showToast('Error fetching cages', 'error')
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

      const { error, warnings } = await harvestRecordService.createHarvestRecord(harvestData)
      if (error) throw error

      showToast(
        formData.harvestType === 'complete'
          ? `Harvest saved. ${selectedCageObject?.name || 'The cage'} is now marked harvested`
          : 'Partial harvest saved. Fish taken off the cage count',
        'success',
      )
      if (warnings?.length) showToast(warnings.join('. '), 'warning')
      clear()
      setFormData({
        ...HARVEST_DEFAULTS,
        harvestDate: new Date().toISOString().split('T')[0],
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
      showToast(error.message || 'Error saving harvest record', 'error')
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

  return (
    <div className="page-card p-6">
      {!showPreview ? (
        <form onSubmit={handleSubmit} noValidate className="space-y-8">
          <div className="space-y-6">
            <h3 className="text-lg font-medium text-chart-ink">Harvest Information</h3>
            <p className="text-sm text-muted -mt-4">Drafts survive a browser refresh.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <LocationMetaField />
              </div>
              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">Cage</label>
                <select
                  name="cageId"
                  value={formData.cageId}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-input-border rounded-lg shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
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
                </select>
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
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Harvest Date
                </label>
                <input
                  type="date"
                  name="harvestDate"
                  value={formData.harvestDate}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-input-border rounded-lg shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Harvest Type
                </label>
                <select
                  name="harvestType"
                  value={formData.harvestType}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-input-border rounded-lg shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                  required
                >
                  <option value="complete">Complete Harvest</option>
                  <option value="partial">Partial Harvest</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Total Weight (kg)
                </label>
                <input
                  type="number"
                  name="totalWeight"
                  value={formData.totalWeight}
                  onChange={handleChange}
                  step="0.01"
                  className="block w-full px-3 py-2 border border-input-border rounded-lg shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Average Body Weight (g)
                </label>
                <input
                  type="number"
                  name="averageBodyWeight"
                  value={formData.averageBodyWeight}
                  onChange={handleChange}
                  step="0.01"
                  className="block w-full px-3 py-2 border border-input-border rounded-lg shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  Estimated Count
                </label>
                <input
                  type="number"
                  name="estimatedCount"
                  value={formData.estimatedCount}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-input-border rounded-lg shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-chart-ink mb-1">
                  FCR (Feed Conversion Ratio)
                </label>
                <input
                  type="number"
                  name="fcr"
                  value={formData.fcr}
                  onChange={(e) => {
                    setFcrTouched(true)
                    handleChange(e)
                  }}
                  step="0.01"
                  className="block w-full px-3 py-2 border border-input-border rounded-lg shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                  required
                />
                {fcrCalc && (
                  <p className="mt-1 text-xs text-muted tabular-nums">
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
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-chart-ink mb-1">
                Size Breakdown (kg)
              </label>
              <p className="text-xs text-muted mb-2 tabular-nums">
                Optional. Leave grades you didn&apos;t sort blank.
                {calculateTotalWeight() > 0 &&
                  ` Grades add up to ${calculateTotalWeight().toLocaleString()} kg${
                    formData.totalWeight ? '' : ', used as the total weight'
                  }.`}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {sizeBreakdown.map((size, index) => (
                  <div key={size.category}>
                    <label className="block text-sm text-muted mb-1">
                      {size.category} ({size.range})
                    </label>
                    <input
                      type="number"
                      value={size.weight}
                      onChange={(e) => handleSizeBreakdownChange(index, e.target.value)}
                      step="0.01"
                      min="0"
                      inputMode="decimal"
                      placeholder="0"
                      className="block w-full px-3 py-2 border border-input-border rounded-lg shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-chart-ink mb-1">Notes</label>
              <textarea
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                rows="3"
                className="block w-full px-3 py-2 border border-input-border rounded-lg shadow-sm focus:outline-none focus:ring-lagoon-800 focus:border-lagoon-800 sm:text-sm"
                placeholder="Optional notes about the harvest"
              />
            </div>
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => onComplete()}
              className="px-4 py-2 border border-input-border rounded-lg shadow-sm text-sm font-medium text-chart-ink bg-white hover:bg-foam-deep/40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || cages.length === 0}
              className="px-4 py-2 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-lagoon-800 hover:bg-lagoon-950 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-lagoon-800 disabled:opacity-60"
            >
              Preview Harvest Record
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-6">
          <h3 className="text-xl font-semibold text-chart-ink border-b pb-4 mb-6">
            Harvest Record Preview
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <p className="text-chart-ink">
              <span className="font-medium text-chart-ink">Cage:</span>{' '}
              {selectedCageObject?.name || 'N/A'}
            </p>
            <p className="text-chart-ink">
              <span className="font-medium text-chart-ink">Harvest Date:</span>{' '}
              {formData.harvestDate}
            </p>
            {selectedCageObject?.stocking_date && (
              <p className="text-chart-ink">
                <span className="font-medium text-chart-ink">Stocking Date:</span>{' '}
                {selectedCageObject.stocking_date}
              </p>
            )}
            <p className="text-chart-ink">
              <span className="font-medium text-chart-ink">Days of Culture (DOC):</span>{' '}
              {cageDoc}
            </p>
            <p className="text-chart-ink">
              <span className="font-medium text-chart-ink">Harvest Type:</span>{' '}
              {formData.harvestType === 'complete' ? 'Complete Harvest' : 'Partial Harvest'}
            </p>
            <p className="md:col-span-2 rounded-lg border border-foam-deep bg-foam p-3 text-sm text-chart-ink">
              {formData.harvestType === 'complete'
                ? `Saving empties ${selectedCageObject?.name || 'this cage'}: its fish count goes to 0, it is marked harvested and its stocking cycle closes.`
                : `Saving takes ${Number(formData.estimatedCount || 0).toLocaleString()} fish off ${selectedCageObject?.name || 'this cage'}'s count.`}
              {selectedCageObject?.current_count != null &&
                ` On record now: ${Number(selectedCageObject.current_count).toLocaleString()} fish.`}
            </p>
            <p className="text-chart-ink">
              <span className="font-medium text-chart-ink">Total Weight (kg):</span>{' '}
              {formData.totalWeight} kg
            </p>
            <p className="text-chart-ink">
              <span className="font-medium text-chart-ink">Average Body Weight (g):</span>{' '}
              {formData.averageBodyWeight} g
            </p>
            <p className="text-chart-ink">
              <span className="font-medium text-chart-ink">Estimated Count:</span>{' '}
              {formData.estimatedCount}
            </p>
            <p className="text-chart-ink">
              <span className="font-medium text-chart-ink">FCR:</span> {formData.fcr}
            </p>
          </div>

          <div className="border-t pt-6 mt-6">
            <h4 className="text-lg font-medium text-chart-ink mb-4">Size Breakdown (kg)</h4>
            <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {sizeBreakdown.map((size) => (
                <li
                  key={size.category}
                  className="bg-foam-deep/40 p-3 rounded-lg text-sm text-gray-800"
                >
                  <span className="font-medium">
                    {size.category} ({size.range}):
                  </span>{' '}
                  {size.weight || '0'} kg
                </li>
              ))}
            </ul>
          </div>

          {formData.notes && (
            <div className="border-t pt-6 mt-6">
              <h4 className="text-lg font-medium text-chart-ink mb-2">Notes</h4>
              <p className="text-sm text-chart-ink bg-foam-deep/40 p-3 rounded-lg">
                {formData.notes}
              </p>
            </div>
          )}

          <div className="flex justify-end space-x-3 mt-8">
            <button
              type="button"
              onClick={handleEdit}
              className="px-4 py-2 border border-input-border rounded-lg shadow-sm text-sm font-medium text-chart-ink bg-white hover:bg-foam-deep/40"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={handleConfirmSave}
              disabled={loading}
              className="px-4 py-2 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-lagoon-800 hover:bg-lagoon-950 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-lagoon-800"
            >
              {loading ? 'Saving...' : 'Confirm Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default HarvestForm
