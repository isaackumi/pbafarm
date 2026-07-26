import React, { useState, useEffect } from 'react'
import { useToast } from './Toast'
import { biweeklyRecordService } from '../lib/databaseService'
import { 
  Plus, 
  Trash, 
  Save, 
  AlertCircle,
  Calculator,
  RefreshCw,
  X,
  CheckCircle
} from 'lucide-react'

const BiweeklyEntryForm = ({ cage, onComplete }) => {
  const { showToast } = useToast()
  const [samplings, setSamplings] = useState([
    { id: 1, fish_count: '', total_weight: '', abw: 0 }
  ])
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [batchCode, setBatchCode] = useState(generateBatchCode())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  // Generate batch code on component mount
  useEffect(() => {
    setBatchCode(generateBatchCode())
  }, [])

  // Clear success message after 3 seconds
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => {
        setSuccess(false)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [success])

  function generateBatchCode() {
    const date = new Date()
    const year = date.getFullYear().toString().slice(-2)
    const month = (date.getMonth() + 1).toString().padStart(2, '0')
    const day = date.getDate().toString().padStart(2, '0')
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
    const code = `BW${year}${month}${day}${random}`
    return code
  }

  const addSampling = () => {
    setSamplings([
      ...samplings,
      {
        id: samplings.length + 1,
        fish_count: '',
        total_weight: '',
        abw: 0
      }
    ])
  }

  const removeSampling = (index) => {
    if (samplings.length > 1) {
      setSamplings(samplings.filter((_, i) => i !== index))
    }
  }

  const updateSampling = (index, field, value) => {
    const newSamplings = [...samplings]
    newSamplings[index] = {
      ...newSamplings[index],
      [field]: value,
      abw: field === 'total_weight' && newSamplings[index].fish_count
        ? (Number(value) / Number(newSamplings[index].fish_count)).toFixed(2)
        : field === 'fish_count' && newSamplings[index].total_weight
          ? (Number(newSamplings[index].total_weight) / Number(value)).toFixed(2)
          : newSamplings[index].abw
    }
    setSamplings(newSamplings)
  }

  const calculateAverageABW = () => {
    const totalWeight = samplings.reduce((sum, s) => sum + Number(s.total_weight || 0), 0)
    const totalFish = samplings.reduce((sum, s) => sum + Number(s.fish_count || 0), 0)
    return totalFish > 0 ? totalWeight / totalFish : 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      // Validate form data
      const totalFish = samplings.reduce((sum, s) => sum + Number(s.fish_count || 0), 0)
      const totalWeight = samplings.reduce((sum, s) => sum + Number(s.total_weight || 0), 0)

      if (totalFish === 0 || totalWeight === 0) {
        throw new Error('Please enter valid fish count and weight data')
      }

      // Create the biweekly record (samples included in one Convex mutation)
      const recordData = {
        cage_id: cage.id || cage._id,
        date,
        batch_code: batchCode,
        average_body_weight: calculateAverageABW(),
        total_fish_count: totalFish,
        total_weight: totalWeight,
        samples: samplings
          .filter((s) => s.fish_count && s.total_weight)
          .map((sampling, index) => ({
            sampling_number: index + 1,
            fish_count: Number(sampling.fish_count),
            total_weight: Number(sampling.total_weight),
            average_body_weight: Number(sampling.abw),
          })),
      }

      const { data: record, error: recordError } = await biweeklyRecordService.createBiweeklyRecord(recordData)

      if (recordError) {
        throw recordError
      }

      showToast('success', 'Biweekly record saved')
      setSuccess(true)

      // Reset form
      setDate(new Date().toISOString().split('T')[0])
      setBatchCode(generateBatchCode())
      setSamplings([{ id: 1, fish_count: '', total_weight: '', abw: 0 }])

      if (onComplete) {
        setTimeout(() => {
          onComplete(record)
        }, 500)
      }
    } catch (error) {
      console.error('Failed to save bi-weekly records:', error)
      setError(error.message || 'Failed to save bi-weekly records')
      showToast('error', 'Failed to save bi-weekly records')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="page-card p-6">
      <div className="mb-6">
        <h2 className="text-lg font-medium text-chart-ink">
          Bi-weekly Records Entry - {cage.name}
        </h2>
        <p className="mt-1 text-sm text-muted">
          Enter sampling data for {cage.name}
        </p>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
          <div className="flex">
            <div className="flex-shrink-0">
              <AlertCircle className="h-5 w-5 text-red-400" />
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">Error</h3>
              <p className="mt-1 text-sm text-red-700">{error}</p>
            </div>
          </div>
        </div>
      )}

      {success && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-md">
          <div className="flex">
            <div className="flex-shrink-0">
              <CheckCircle className="h-5 w-5 text-green-400" />
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-green-800">Success</h3>
              <p className="mt-1 text-sm text-green-700">
                Bi-weekly records saved successfully
              </p>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Summary Section - Moved to top */}
        <div className="bg-gradient-to-r from-foam to-foam-deep p-8 rounded-xl border-2 border-foam-deep shadow-sm">
          <h3 className="text-xl font-semibold text-lagoon-950 mb-6">Summary</h3>
          <dl className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-foam-deep">
              <dt className="text-base font-medium text-lagoon-800 mb-2">Total Fish Count</dt>
              <dd className="text-3xl font-bold text-lagoon-950">
                {samplings.reduce((sum, s) => sum + Number(s.fish_count || 0), 0).toLocaleString()}
              </dd>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-sm border border-foam-deep">
              <dt className="text-base font-medium text-lagoon-800 mb-2">Total Weight</dt>
              <dd className="text-3xl font-bold text-lagoon-950">
                {samplings.reduce((sum, s) => sum + Number(s.total_weight || 0), 0).toFixed(2)}g
              </dd>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-sm border border-foam-deep">
              <dt className="text-base font-medium text-lagoon-800 mb-2">Average ABW</dt>
              <dd className="text-3xl font-bold text-lagoon-950">
                {calculateAverageABW().toFixed(2)}g
              </dd>
            </div>
          </dl>
        </div>

        {/* Batch Code Display */}
        <div className="bg-gradient-to-r from-gray-50 to-gray-100 p-6 rounded-xl border-2 border-foam-deep shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <label className="block text-base font-medium text-chart-ink mb-2">Batch Code</label>
              <p className="text-3xl font-mono font-bold text-lagoon-800 tracking-wider bg-white px-4 py-3 rounded-lg border-2 border-foam-deep shadow-sm">
                {batchCode}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setBatchCode(generateBatchCode())}
              className="inline-flex items-center px-4 py-3 border-2 border-input-border shadow-sm text-base font-medium rounded-lg text-chart-ink bg-white hover:bg-foam-deep/40 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-lagoon-800 transition-colors"
            >
              <RefreshCw className="w-5 h-5 mr-2" />
              Generate New Code
            </button>
          </div>
        </div>

        {/* Date Field */}
        <div>
          <label htmlFor="date" className="block text-base font-medium text-chart-ink mb-2">
            Sampling Date
          </label>
          <input
            type="date"
            id="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 block w-full px-4 py-3 border-2 border-input-border rounded-lg shadow-sm focus:ring-2 focus:ring-lagoon-800 focus:border-lagoon-800 text-base"
            required
          />
        </div>

        {/* Sampling Data */}
        <div>
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-semibold text-chart-ink">Sampling Data</h3>
            <button
              type="button"
              onClick={addSampling}
              className="inline-flex items-center px-4 py-3 border border-transparent text-base font-medium rounded-lg text-white bg-lagoon-800 hover:bg-lagoon-950 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-lagoon-800 transition-colors"
            >
              <Plus className="w-5 h-5 mr-2" />
              Add Sampling
            </button>
          </div>

          <div className="space-y-6">
            {samplings.map((sampling, index) => (
              <div key={sampling.id} className="bg-white p-6 rounded-lg border-2 border-foam-deep shadow-sm hover:border-lagoon-800/40 transition-colors">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-lg font-semibold text-chart-ink">Sampling {index + 1}</h4>
                  {samplings.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeSampling(index)}
                      className="text-red-600 hover:text-red-800 p-2 rounded-lg hover:bg-red-50 transition-colors"
                      title="Remove this sampling"
                    >
                      <Trash className="w-5 h-5" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                  <div>
                    <label className="block text-base font-medium text-chart-ink mb-2">
                      Fish Count
                    </label>
                    <input
                      type="number"
                      value={sampling.fish_count}
                      onChange={(e) => updateSampling(index, 'fish_count', e.target.value)}
                      className="block w-full px-4 py-3 border-2 border-input-border rounded-lg shadow-sm focus:ring-2 focus:ring-lagoon-800 focus:border-lagoon-800 text-base placeholder-gray-400"
                      placeholder="Enter fish count"
                      min="0"
                    />
                    <p className="mt-1 text-sm text-muted">Number of fish in this sample</p>
                  </div>

                  <div>
                    <label className="block text-base font-medium text-chart-ink mb-2">
                      Total Weight (g)
                    </label>
                    <input
                      type="number"
                      value={sampling.total_weight}
                      onChange={(e) => updateSampling(index, 'total_weight', e.target.value)}
                      className="block w-full px-4 py-3 border-2 border-input-border rounded-lg shadow-sm focus:ring-2 focus:ring-lagoon-800 focus:border-lagoon-800 text-base placeholder-gray-400"
                      placeholder="0.00"
                      min="0"
                      step="0.01"
                    />
                    <p className="mt-1 text-sm text-muted">Total weight of the sample in grams</p>
                  </div>

                  <div>
                    <label className="block text-base font-medium text-chart-ink mb-2">
                      Average ABW (g)
                    </label>
                    <input
                      type="number"
                      value={sampling.abw}
                      className="block w-full px-4 py-3 border-2 border-foam-deep rounded-lg shadow-sm bg-foam-deep/40 text-base text-chart-ink font-mono"
                      placeholder="0.00"
                      readOnly
                    />
                    <p className="mt-1 text-sm text-muted">Calculated automatically</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Submit Button */}
        <div className="flex justify-end pt-6 border-t border-foam-deep">
          <button
            type="submit"
            disabled={loading}
            className={`inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-lg shadow-sm text-white transition-colors ${
              loading
                ? 'bg-lagoon-700 cursor-not-allowed'
                : 'bg-lagoon-800 hover:bg-lagoon-950 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-lagoon-800'
            }`}
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-3"></div>
                Saving...
              </>
            ) : (
              <>
                <Save className="w-5 h-5 mr-3" />
                Save Bi-weekly Record
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}

export default BiweeklyEntryForm 