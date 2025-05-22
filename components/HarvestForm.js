import React, { useState, useEffect } from 'react'
import { cages } from '../data/cages'
import { dailyRecords } from '../data/daily-records'
import { biweeklyRecords } from '../data/biweekly-records'
import { harvestRecordService } from '../lib/databaseService'
import { useToast } from './Toast'

const HarvestForm = ({ cageId, onComplete }) => {
  const [formData, setFormData] = useState({
    harvestDate: new Date().toISOString().split('T')[0],
    averageBodyWeight: '',
    totalWeight: '',
    estimatedCount: '',
    fcr: '',
    notes: '',
    sizeBreakdown: [{ range: '', percentage: '' }],
  })
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const { showToast } = useToast()

  const selectedCage = cages.find((cage) => cage.id === cageId)

  // Check if cage has been harvested already
  const [existingHarvest, setExistingHarvest] = useState(null)

  useEffect(() => {
    const checkExistingHarvest = async () => {
      try {
        const { data, error } = await harvestRecordService.getHarvestRecord(cageId)
        if (error) throw error
        setExistingHarvest(data)
      } catch (error) {
        console.error('Error checking existing harvest:', error)
        showToast('Error checking existing harvest', 'error')
      }
    }

    checkExistingHarvest()
  }, [cageId])

  // Get the most recent ABW for pre-filling
  const latestAbw = biweeklyRecords
    .filter((record) => record.cageId === cageId)
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0]

  // Calculate total feed given to the cage
  const totalFeed = dailyRecords
    .filter((record) => record.cageId === cageId)
    .reduce((sum, record) => sum + record.feedAmount, 0)

  // Calculate estimated count based on mortality
  const initialCount = selectedCage?.initialCount || 0
  const totalMortality = dailyRecords
    .filter((record) => record.cageId === cageId)
    .reduce((sum, record) => sum + record.mortality, 0)
  const estimatedRemainingCount = initialCount - totalMortality

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))

    // Auto-calculate fields when possible
    if (name === 'totalWeight' || name === 'averageBodyWeight') {
      const abw =
        name === 'averageBodyWeight'
          ? parseFloat(value) || 0
          : parseFloat(formData.averageBodyWeight) || 0
      const totalWt =
        name === 'totalWeight'
          ? parseFloat(value) || 0
          : parseFloat(formData.totalWeight) || 0

      if (abw > 0 && totalWt > 0) {
        // Calculate estimated count (total weight in kg / average weight in g * 1000)
        const estCount = Math.round(totalWt / (abw / 1000))
        setFormData((prev) => ({
          ...prev,
          estimatedCount: estCount.toString(),
        }))

        // Calculate FCR if we have total feed data
        if (totalFeed > 0) {
          const biomassGain = totalWt - (selectedCage?.initialWeight || 0)
          if (biomassGain > 0) {
            const fcr = (totalFeed / biomassGain).toFixed(2)
            setFormData((prev) => ({ ...prev, fcr }))
          }
        }
      }
    }
  }

  const handleSizeBreakdownChange = (index, field, value) => {
    const updatedBreakdown = [...formData.sizeBreakdown]
    updatedBreakdown[index] = {
      ...updatedBreakdown[index],
      [field]: value,
    }
    setFormData((prev) => ({ ...prev, sizeBreakdown: updatedBreakdown }))
  }

  const addSizeRange = () => {
    setFormData((prev) => ({
      ...prev,
      sizeBreakdown: [...prev.sizeBreakdown, { range: '', percentage: '' }],
    }))
  }

  const removeSizeRange = (index) => {
    if (formData.sizeBreakdown.length > 1) {
      const updatedBreakdown = formData.sizeBreakdown.filter(
        (_, i) => i !== index,
      )
      setFormData((prev) => ({ ...prev, sizeBreakdown: updatedBreakdown }))
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)

    try {
      // Validate size breakdown percentages sum to 100%
      const totalPercentage = formData.sizeBreakdown.reduce(
        (sum, size) => sum + (parseFloat(size.percentage) || 0),
        0,
      )
      if (Math.abs(totalPercentage - 100) > 0.01) {
        throw new Error('Size breakdown percentages must sum to 100%')
      }

      const harvestData = {
        cage_id: cageId,
        harvest_date: formData.harvestDate,
        average_body_weight: parseFloat(formData.averageBodyWeight),
        total_weight: parseFloat(formData.totalWeight),
        estimated_count: parseInt(formData.estimatedCount),
        fcr: parseFloat(formData.fcr) || null,
        notes: formData.notes,
        size_breakdown: formData.sizeBreakdown.map((size) => ({
          range: size.range,
          percentage: parseFloat(size.percentage),
        })),
      }

      const { error } = await harvestRecordService.createHarvestRecord(harvestData)
      if (error) throw error

      showToast('Harvest record saved successfully', 'success')
      if (onComplete) {
        onComplete()
      }
    } catch (error) {
      console.error('Error saving harvest record:', error)
      showToast(error.message || 'Error saving harvest record', 'error')
    } finally {
      setLoading(false)
    }
  }

  if (!selectedCage) {
    return (
      <div className="bg-white shadow rounded-lg p-8">
        <p className="text-center text-gray-600">Please select a cage first</p>
      </div>
    )
  }

  if (existingHarvest) {
    return (
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="font-medium text-gray-700">
            Harvest Data - {selectedCage.name}
          </h2>
        </div>
        <div className="p-6">
          <div className="bg-yellow-50 p-4 rounded-md text-yellow-800 mb-4">
            <p className="font-medium">
              This cage has already been harvested on{' '}
              {new Date(existingHarvest.harvest_date).toLocaleDateString()}.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p className="text-sm font-medium text-gray-700">Harvest Date</p>
              <p className="mt-1 text-gray-900">
                {new Date(existingHarvest.harvest_date).toLocaleDateString()}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">
                Average Body Weight
              </p>
              <p className="mt-1 text-gray-900">
                {existingHarvest.average_body_weight} g
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">Total Weight</p>
              <p className="mt-1 text-gray-900">
                {existingHarvest.total_weight} kg
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">
                Estimated Count
              </p>
              <p className="mt-1 text-gray-900">
                {existingHarvest.estimated_count}
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">FCR</p>
              <p className="mt-1 text-gray-900">
                {existingHarvest.fcr?.toFixed(2) || 'N/A'}
              </p>
            </div>
          </div>

          <div className="mt-6">
            <p className="text-sm font-medium text-gray-700 mb-2">
              Size Breakdown
            </p>
            <div className="bg-gray-50 p-4 rounded-md">
              <div className="grid grid-cols-2 gap-4">
                <div className="text-sm font-medium text-gray-700">
                  Size Range
                </div>
                <div className="text-sm font-medium text-gray-700">
                  Percentage
                </div>

                {existingHarvest.size_breakdown.map((size, index) => (
                  <React.Fragment key={index}>
                    <div className="text-gray-900">{size.range}</div>
                    <div className="text-gray-900">{size.percentage}%</div>
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white shadow rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="font-medium text-gray-700">
          Harvest Data - {selectedCage.name}
        </h2>
      </div>
      <div className="p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Harvest Date
              </label>
              <input
                type="date"
                name="harvestDate"
                value={formData.harvestDate}
                onChange={handleChange}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Average Body Weight (g)
              </label>
              <input
                type="number"
                name="averageBodyWeight"
                value={formData.averageBodyWeight}
                onChange={handleChange}
                step="0.1"
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder={
                  latestAbw ? latestAbw.averageBodyWeight.toString() : '0.0'
                }
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Total Weight Harvested (kg)
              </label>
              <input
                type="number"
                name="totalWeight"
                value={formData.totalWeight}
                onChange={handleChange}
                step="0.1"
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="0.0"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Estimated Number of Fish
              </label>
              <input
                type="number"
                name="estimatedCount"
                value={formData.estimatedCount}
                onChange={handleChange}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder={estimatedRemainingCount.toString()}
              />
              <p className="mt-1 text-xs text-gray-500">
                Estimated count based on mortalities: {estimatedRemainingCount}
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                FCR
              </label>
              <input
                type="number"
                name="fcr"
                value={formData.fcr}
                onChange={handleChange}
                step="0.01"
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="0.00"
              />
              <p className="mt-1 text-xs text-gray-500">
                Total feed: {totalFeed.toFixed(1)} kg
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Size Breakdown
            </label>
            <div className="bg-gray-50 p-4 rounded-md space-y-3">
              {formData.sizeBreakdown.map((size, index) => (
                <div key={index} className="grid grid-cols-5 gap-3">
                  <div className="col-span-2">
                    <input
                      type="text"
                      value={size.range}
                      onChange={(e) =>
                        handleSizeBreakdownChange(
                          index,
                          'range',
                          e.target.value,
                        )
                      }
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="e.g. 300-350g"
                      required
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number"
                      value={size.percentage}
                      onChange={(e) =>
                        handleSizeBreakdownChange(
                          index,
                          'percentage',
                          e.target.value,
                        )
                      }
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      placeholder="%"
                      min="0"
                      max="100"
                      required
                    />
                  </div>
                  <div className="flex items-center">
                    <button
                      type="button"
                      onClick={() => removeSizeRange(index)}
                      className="text-red-600 hover:text-red-800"
                      disabled={formData.sizeBreakdown.length <= 1}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={addSizeRange}
                className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-indigo-700 bg-indigo-100 hover:bg-indigo-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                Add Size Range
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes
            </label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              rows="3"
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              placeholder="Optional notes about harvest conditions, quality, etc."
            ></textarea>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Save Harvest Record'}
            </button>
          </div>

          {message && (
            <div className="bg-green-50 text-green-800 p-4 rounded-md">
              {message}
            </div>
          )}
        </form>
      </div>
    </div>
  )
}

export default HarvestForm
