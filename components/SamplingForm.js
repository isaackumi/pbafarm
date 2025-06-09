import React, { useState } from 'react'
import { harvestRecordService } from '../lib/databaseService'
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

const SamplingForm = ({ harvestId, onComplete }) => {
  const [formData, setFormData] = useState({
    crateSize: '50', // Default to 50kg crate
    samples: SIZE_CATEGORIES.map(category => ({
      category: category.category,
      range: category.range,
      quantity: '',
      abw: ''
    }))
  })
  const [loading, setLoading] = useState(false)
  const { showToast } = useToast()

  const handleSamplingDataChange = (index, field, value) => {
    const newSamples = [...formData.samples]
    newSamples[index][field] = value
    setFormData(prev => ({ ...prev, samples: newSamples }))
  }

  const handleCrateSizeChange = (value) => {
    setFormData(prev => ({
      ...prev,
      crateSize: value
    }))
  }

  const validateForm = () => {
    // Check if at least one sampling data point is entered
    const hasSamplingData = formData.samples.some(
      sample => sample.quantity && sample.abw
    )
    if (!hasSamplingData) {
      showToast('Please enter at least one sampling data point', 'error')
      return false
    }

    return true
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validateForm()) return

    setLoading(true)
    try {
      const samplingData = {
        harvest_id: harvestId,
        crate_size: parseInt(formData.crateSize),
        samples: formData.samples
          .filter(sample => sample.quantity && sample.abw)
          .map(sample => ({
            size: sample.category,
            range: sample.range,
            quantity: parseInt(sample.quantity),
            abw: parseFloat(sample.abw)
          }))
      }

      const { error } = await harvestRecordService.addSamplingData(samplingData)
      if (error) throw error

      showToast('Sampling data saved successfully', 'success')
      if (onComplete) {
        onComplete()
      }
    } catch (error) {
      console.error('Error saving sampling data:', error)
      showToast(error.message || 'Error saving sampling data', 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <div className="space-y-6">
        <h3 className="text-lg font-medium text-gray-900">Harvest Sampling Data</h3>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Crate Size
          </label>
          <select
            value={formData.crateSize}
            onChange={(e) => handleCrateSizeChange(e.target.value)}
            className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
          >
            <option value="50">50 kg</option>
            <option value="25">25 kg</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Sampling Data
          </label>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Size
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Range
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Quantity per Crate
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    ABW (g)
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {formData.samples.map((sample, index) => (
                  <tr key={sample.category}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {sample.category}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {sample.range}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <input
                        type="number"
                        value={sample.quantity}
                        onChange={(e) => handleSamplingDataChange(index, 'quantity', e.target.value)}
                        className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <input
                        type="number"
                        value={sample.abw}
                        onChange={(e) => handleSamplingDataChange(index, 'abw', e.target.value)}
                        step="0.1"
                        className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
          {loading ? 'Saving...' : 'Save Sampling Data'}
        </button>
      </div>
    </form>
  )
}

export default SamplingForm 