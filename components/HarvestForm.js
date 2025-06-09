import React, { useState, useEffect } from 'react'
import { harvestRecordService, cageService } from '../lib/databaseService'
import { useToast } from './Toast'

const SIZE_CATEGORIES = [
  { category: 'S3', range: '800g above' },
  { category: 'S2', range: '700g-800g' },
  { category: 'S1', range: '600g-700g' },
  { category: 'Reg', range: '500g-600g' },
  { category: 'Eco', range: '400g-500g' },
  { category: 'SS', range: '300g-400g' },
  { category: 'SB', range: '200g-300g' },
  { category: 'Rej', range: 'less than 200g' }
]

const HarvestForm = ({ onComplete }) => {
  const [formData, setFormData] = useState({
    harvestDate: new Date().toISOString().split('T')[0],
    cageId: '',
    harvestType: 'complete', // 'complete' or 'partial'
    totalWeight: '',
    averageBodyWeight: '',
    estimatedCount: '',
    fcr: '',
    sizeBreakdown: SIZE_CATEGORIES.map(category => ({
      category: category.category,
      range: category.range,
      weight: ''
    })),
    notes: ''
  })
  const [loading, setLoading] = useState(false)
  const [cages, setCages] = useState([])
  const [showPreview, setShowPreview] = useState(false)
  const { showToast } = useToast()

  // Fetch active cages
  useEffect(() => {
    const fetchCages = async () => {
      try {
        const { data, error } = await cageService.getActiveCages()
        if (error) throw error
        setCages(data || [])
      } catch (error) {
        console.error('Error fetching cages:', error)
        showToast('Error fetching cages', 'error')
      }
    }

    fetchCages()
  }, [])

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
  }

  const handleSizeBreakdownChange = (index, value) => {
    const newSizeBreakdown = [...formData.sizeBreakdown]
    newSizeBreakdown[index].weight = value
    setFormData(prev => ({ ...prev, sizeBreakdown: newSizeBreakdown }))
  }

  const calculateTotalWeight = () => {
    return formData.sizeBreakdown.reduce((sum, size) => {
      return sum + (parseFloat(size.weight) || 0)
    }, 0)
  }

  const validateForm = () => {
    if (!formData.cageId) {
      showToast('Please select a cage', 'error')
      return false
    }

    if (!formData.totalWeight || !formData.averageBodyWeight || !formData.estimatedCount || !formData.fcr) {
      showToast('Please fill in all required fields', 'error')
      return false
    }

    // Check if total weight matches sum of size breakdown
    const totalFromBreakdown = calculateTotalWeight()
    if (Math.abs(totalFromBreakdown - parseFloat(formData.totalWeight)) > 0.01) {
      showToast('Total weight must match the sum of size breakdown weights', 'error')
      return false
    }

    // Check if all size breakdown weights are numbers (even if 0)
    const invalidSizeBreakdown = formData.sizeBreakdown.some(size => isNaN(parseFloat(size.weight)))
    if (invalidSizeBreakdown) {
       showToast('Please ensure all size breakdown weights are valid numbers', 'error');
       return false;
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
         size_breakdown: formData.sizeBreakdown.map(size => ({
           range: size.range,
           weight: parseFloat(size.weight)
         })),
         notes: formData.notes
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
       setLoading(false)
       setShowPreview(false)
     }
   }

  const handleEdit = () => {
    setShowPreview(false)
  }

  const selectedCageObject = cages.find(cage => cage.id === formData.cageId)

  // Calculate Days of Culture (DOC)
  const calculateDoc = () => {
    if (!selectedCageObject || !selectedCageObject.stocking_date || !formData.harvestDate) return 'N/A'
    const stockingDate = new Date(selectedCageObject.stocking_date)
    const harvestDate = new Date(formData.harvestDate)
    const timeDiff = harvestDate.getTime() - stockingDate.getTime()
    const dayDiff = Math.ceil(timeDiff / (1000 * 3600 * 24))
    return dayDiff >= 0 ? dayDiff : 'N/A' // Ensure DOC is not negative
  }

  const cageDoc = calculateDoc()

  return (
    <div className="bg-white shadow rounded-lg p-6">
      {!showPreview ? (
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Basic Information */}
          <div className="space-y-6">
            <h3 className="text-lg font-medium text-gray-900">Harvest Information</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Cage
                </label>
                <select
                  name="cageId"
                  value={formData.cageId}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  required
                >
                  <option value="">Select a cage</option>
                  {cages.map(cage => (
                    <option key={cage.id} value={cage.id}>
                      {cage.name}
                    </option>
                  ))}
                </select>
              </div>

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
                  Harvest Type
                </label>
                <select
                  name="harvestType"
                  value={formData.harvestType}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  required
                >
                  <option value="complete">Complete Harvest</option>
                  <option value="partial">Partial Harvest</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Total Weight (kg)
                </label>
                <input
                  type="number"
                  name="totalWeight"
                  value={formData.totalWeight}
                  onChange={handleChange}
                  step="0.01"
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
                  step="0.01"
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Estimated Count
                </label>
                <input
                  type="number"
                  name="estimatedCount"
                  value={formData.estimatedCount}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  FCR (Feed Conversion Ratio)
                </label>
                <input
                  type="number"
                  name="fcr"
                  value={formData.fcr}
                  onChange={handleChange}
                  step="0.01"
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Size Breakdown (kg)
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {formData.sizeBreakdown.map((size, index) => (
                  <div key={size.category}>
                    <label className="block text-sm text-gray-600 mb-1">
                      {size.category} ({size.range})
                    </label>
                    <input
                      type="number"
                      value={size.weight}
                      onChange={(e) => handleSizeBreakdownChange(index, e.target.value)}
                      step="0.01"
                      className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      required
                    />
                  </div>
                ))}
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
                placeholder="Optional notes about the harvest"
              />
            </div>
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => onComplete()}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Preview Harvest Record
            </button>
          </div>
        </form>
      ) : (
        /* Preview Section */
        <div className="space-y-6">
          <h3 className="text-xl font-semibold text-gray-900 border-b pb-4 mb-6">Harvest Record Preview</h3>

          {/* Basic Information Preview */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <p className="text-gray-700"><span className="font-medium text-gray-900">Cage:</span> {selectedCageObject?.name || 'N/A'}</p>
            <p className="text-gray-700"><span className="font-medium text-gray-900">Harvest Date:</span> {formData.harvestDate}</p>
            {selectedCageObject?.stocking_date && (
              <p className="text-gray-700"><span className="font-medium text-gray-900">Stocking Date:</span> {selectedCageObject.stocking_date}</p>
            )}
            <p className="text-gray-700"><span className="font-medium text-gray-900">Days of Culture (DOC):</span> {cageDoc}</p>
            <p className="text-gray-700"><span className="font-medium text-gray-900">Harvest Type:</span> {formData.harvestType === 'complete' ? 'Complete Harvest' : 'Partial Harvest'}</p>
            <p className="text-gray-700"><span className="font-medium text-gray-900">Total Weight (kg):</span> {formData.totalWeight} kg</p>
            <p className="text-gray-700"><span className="font-medium text-gray-900">Average Body Weight (g):</span> {formData.averageBodyWeight} g</p>
            <p className="text-gray-700"><span className="font-medium text-gray-900">Estimated Count:</span> {formData.estimatedCount}</p>
            <p className="text-gray-700"><span className="font-medium text-gray-900">FCR:</span> {formData.fcr}</p>
          </div>

          {/* Size Breakdown Preview */}
          <div className="border-t pt-6 mt-6">
            <h4 className="text-lg font-medium text-gray-900 mb-4">Size Breakdown (kg)</h4>
            <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {formData.sizeBreakdown.map(size => (
                <li key={size.category} className="bg-gray-50 p-3 rounded-md text-sm text-gray-800">
                  <span className="font-medium">{size.category} ({size.range}):</span> {size.weight || '0'} kg
                </li>
              ))}
            </ul>
          </div>

          {/* Notes Preview */}
          {formData.notes && (
            <div className="border-t pt-6 mt-6">
              <h4 className="text-lg font-medium text-gray-900 mb-2">Notes</h4>
              <p className="text-sm text-gray-700 bg-gray-50 p-3 rounded-md">{formData.notes}</p>
            </div>
          )}

          <div className="flex justify-end space-x-3 mt-8">
            <button
              type="button"
              onClick={handleEdit}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={handleConfirmSave}
              disabled={loading}
              className="px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
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
