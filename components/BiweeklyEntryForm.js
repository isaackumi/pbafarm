import React, { useState, useEffect } from 'react'
import { useToast } from './Toast'
import { supabase } from '../lib/supabase'
import { 
  Plus, 
  Trash, 
  Save, 
  AlertCircle,
  Calculator,
  RefreshCw,
  X
} from 'lucide-react'

const BiweeklyEntryForm = ({ cage }) => {
  const { showToast } = useToast()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [samplings, setSamplings] = useState([
    { id: 1, fish_count: '', total_weight: '', abw: 0 }
  ])
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [batchCode, setBatchCode] = useState(generateBatchCode())

  // Generate batch code on component mount
  useEffect(() => {
    generateBatchCode()
  }, [])

  function generateBatchCode() {
    const date = new Date()
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
    const code = `BW${year}${month}${day}-${random}`
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
    setSamplings(samplings.filter((_, i) => i !== index))
  }

  const updateSampling = (index, field, value) => {
    const newSamplings = [...samplings]
    newSamplings[index] = {
      ...newSamplings[index],
      [field]: value,
      abw: field === 'fish_count' || field === 'total_weight'
        ? calculateABW(
            field === 'fish_count' ? value : newSamplings[index].fish_count,
            field === 'total_weight' ? value : newSamplings[index].total_weight
          )
        : newSamplings[index].abw
    }
    setSamplings(newSamplings)
  }

  const calculateABW = (fishCount, totalWeight) => {
    if (!fishCount || !totalWeight || fishCount === '0' || totalWeight === '0') {
      return 0
    }
    return (Number(totalWeight) / Number(fishCount))
  }

  const calculateAverageABW = () => {
    const validSamplings = samplings.filter(
      s => s.fish_count && s.total_weight && s.fish_count !== '0' && s.total_weight !== '0'
    )
    if (validSamplings.length === 0) return 0

    const totalABW = validSamplings.reduce((sum, s) => sum + s.abw, 0)
    return totalABW / validSamplings.length
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')

    try {
      // Validate inputs
      if (!date) throw new Error('Date is required')
      if (samplings.some(s => !s.fish_count || !s.total_weight)) {
        throw new Error('All sampling fields are required')
      }

      // Calculate average ABW
      const averageABW = calculateAverageABW()
      if (averageABW === 0) {
        throw new Error('Invalid sampling data')
      }

      // Save bi-weekly record
      const { data: record, error: recordError } = await supabase
        .from('biweekly_records')
        .insert([
          {
            cage_id: cage.id,
            date,
            batch_code: batchCode,
            average_body_weight: averageABW,
            total_fish_count: samplings.reduce((sum, s) => sum + Number(s.fish_count), 0),
            total_weight: samplings.reduce((sum, s) => sum + Number(s.total_weight), 0)
          }
        ])
        .select()
        .single()

      if (recordError) throw recordError

      // Save sampling records
      const { error: samplingError } = await supabase
        .from('biweekly_sampling')
        .insert(
          samplings.map((s, index) => ({
            biweekly_record_id: record.id,
            sampling_number: index + 1,
            fish_count: s.fish_count,
            total_weight: s.total_weight,
            average_body_weight: s.abw
          }))
        )

      if (samplingError) throw samplingError

      setSuccess('Bi-weekly records saved successfully')
      showToast('success', 'Bi-weekly records saved successfully')
      
      // Reset form
      setSamplings([{ id: 1, fish_count: '', total_weight: '', abw: 0 }])
      generateBatchCode()
    } catch (error) {
      console.error('Error saving bi-weekly records:', error)
      setError(error.message)
      showToast('error', error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <div className="mb-6">
        <h2 className="text-lg font-medium text-gray-900">
          Bi-weekly Records Entry - {cage.name}
        </h2>
        <p className="mt-1 text-sm text-gray-500">
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
        {/* Batch Code Display */}
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
          <div className="flex items-center justify-between">
            <div>
              <label className="block text-sm font-medium text-gray-700">Batch Code</label>
              <p className="mt-1 text-2xl font-mono font-bold text-indigo-600 tracking-wider">
                {batchCode}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setBatchCode(generateBatchCode())}
              className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Generate New Code
            </button>
          </div>
        </div>

        {/* Date Field */}
        <div>
          <label htmlFor="date" className="block text-sm font-medium text-gray-700">
            Date
          </label>
          <input
            type="date"
            id="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
            required
          />
        </div>

        {/* Sampling Entries */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-gray-900">Sampling Entries</h3>
            <button
              type="button"
              onClick={addSampling}
              className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Sample
            </button>
          </div>

          {samplings.map((sampling, index) => (
            <div
              key={index}
              className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-gray-700">
                  Sample {index + 1}
                </h4>
                {samplings.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeSampling(index)}
                    className="text-red-600 hover:text-red-800"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Number of Fish
                  </label>
                  <input
                    type="number"
                    value={sampling.fish_count}
                    onChange={(e) => updateSampling(index, 'fish_count', e.target.value)}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    required
                    min="1"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Total Weight (g)
                  </label>
                  <input
                    type="number"
                    value={sampling.total_weight}
                    onChange={(e) => updateSampling(index, 'total_weight', e.target.value)}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    required
                    min="0"
                    step="0.01"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Average Body Weight (g)
                  </label>
                  <div className="mt-1 block w-full bg-gray-100 border border-gray-300 rounded-md shadow-sm py-2 px-3 text-gray-900 sm:text-sm">
                    {sampling.abw.toFixed(2)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Summary Section */}
        <div className="bg-indigo-50 p-4 rounded-lg border border-indigo-200">
          <h3 className="text-sm font-medium text-indigo-900">Summary</h3>
          <dl className="mt-2 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm font-medium text-indigo-700">Total Fish Count</dt>
              <dd className="mt-1 text-lg font-semibold text-indigo-900">
                {samplings.reduce((sum, s) => sum + Number(s.fish_count), 0).toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-indigo-700">Total Weight</dt>
              <dd className="mt-1 text-lg font-semibold text-indigo-900">
                {samplings.reduce((sum, s) => sum + Number(s.total_weight), 0).toFixed(2)}g
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-sm font-medium text-indigo-700">Average ABW</dt>
              <dd className="mt-1 text-lg font-semibold text-indigo-900">
                {calculateAverageABW().toFixed(2)}g
              </dd>
            </div>
          </dl>
        </div>

        {/* Submit Button */}
        <div className="flex justify-end">
          <button
            type="submit"
            className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Save Records
          </button>
        </div>
      </form>
    </div>
  )
}

export default BiweeklyEntryForm 