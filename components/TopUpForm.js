// components/TopUpForm.js
import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { AlertCircle } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import stockingService from '../lib/stockingService'
import { useToast } from './Toast'

const TopUpForm = ({ onComplete }) => {
  const router = useRouter()
  const { user } = useAuth()
  const { showToast } = useToast()

  const [loading, setLoading] = useState(false)
  const [fetchingData, setFetchingData] = useState(true)
  const [activeStockings, setActiveStockings] = useState([])
  const [error, setError] = useState('')
  const [selectedStocking, setSelectedStocking] = useState(null)
  const [formData, setFormData] = useState({
    stocking_id: '',
    topup_date: new Date().toISOString().split('T')[0],
    fish_count: '',
    abw: '',
    source_location: '',
    transfer_supervisor: '',
    notes: '',
  })

  // Fetch active stockings that can be topped up
  useEffect(() => {
    async function fetchStockings() {
      setFetchingData(true)
      try {
        const { data, error } = await stockingService.getActiveStockings()

        if (error) throw error

        console.log('Active stockings:', data)
        setActiveStockings(data || [])
      } catch (error) {
        console.error('Error fetching active stockings:', error)
        setError('Failed to load active stockings. Please try again.')
        showToast('error', 'Failed to load active stockings')
      } finally {
        setFetchingData(false)
      }
    }

    fetchStockings()
  }, [])

  // When a stocking is selected, fetch its details
  useEffect(() => {
    async function fetchStockingDetails(id) {
      try {
        const { data, error } = await stockingService.getStockingById(id)

        if (error) throw error

        console.log('Selected stocking details:', data)
        setSelectedStocking(data)
      } catch (error) {
        console.error('Error fetching stocking details:', error)
        setError('Failed to load stocking details')
        showToast('error', 'Failed to load stocking details')
      }
    }

    if (formData.stocking_id) {
      fetchStockingDetails(formData.stocking_id)
    } else {
      setSelectedStocking(null)
    }
  }, [formData.stocking_id])

  // Calculate estimated biomass based on fish count and ABW
  const calculateBiomass = () => {
    if (!formData.fish_count || !formData.abw) return 0

    const count = parseFloat(formData.fish_count)
    const abw = parseFloat(formData.abw)

    if (isNaN(count) || isNaN(abw)) return 0

    // Calculate biomass in kg (ABW in grams / 1000 * count)
    return (abw / 1000) * count
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      // Validate inputs
      if (!formData.stocking_id) {
        throw new Error('Please select a batch to top up')
      }

      if (!formData.fish_count || parseInt(formData.fish_count) <= 0) {
        throw new Error('Please enter a valid fish count')
      }

      if (!formData.abw || parseFloat(formData.abw) <= 0) {
        throw new Error('Please enter a valid average body weight')
      }

      // Prepare submission data
      const data = {
        ...formData,
        company_id: user?.company_id || '00000000-0000-0000-0000-000000000001', // Default company for now
        created_by: user?.id,
      }

      // Submit top-up
      const { data: result, error } = await stockingService.createTopUp(data)

      if (error) throw error

      showToast(
        'success',
        'Top-up request submitted successfully. Awaiting approval.',
      )

      // Reset form or redirect
      if (onComplete) {
        onComplete(result)
      } else {
        router.push('/stocking-management')
      }
    } catch (error) {
      console.error('Error creating top-up:', error)
      setError(error.message)
      showToast('error', error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white shadow rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="font-medium text-gray-700">Top-Up Existing Batch</h2>
      </div>

      <div className="p-6">
        {error && (
          <div className="mb-6 bg-red-50 text-red-800 p-4 rounded-md flex items-start">
            <AlertCircle className="h-5 w-5 mr-2 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Batch Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Select Batch to Top-Up <span className="text-red-500">*</span>
            </label>
            {fetchingData ? (
              <div className="flex items-center space-x-2 h-10">
                <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                <span className="text-sm text-gray-500">
                  Loading batches...
                </span>
              </div>
            ) : (
              <>
                <select
                  name="stocking_id"
                  value={formData.stocking_id}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                  required
                  disabled={activeStockings.length === 0}
                >
                  <option value="">Select a batch</option>
                  {activeStockings.map((stocking) => (
                    <option key={stocking.id} value={stocking.id}>
                      {stocking.batch_number} - {stocking.cage.name} - Stocked:{' '}
                      {new Date(stocking.stocking_date).toLocaleDateString()}
                    </option>
                  ))}
                </select>
                {activeStockings.length === 0 && !fetchingData && (
                  <p className="mt-1 text-xs text-red-500">
                    No active batches found. You need an active stocking to
                    perform a top-up.
                  </p>
                )}
              </>
            )}
          </div>

          {/* Current Batch Info (if selected) */}
          {selectedStocking && (
            <div className="bg-blue-50 p-4 rounded-md">
              <h3 className="text-sm font-medium text-blue-800 mb-2">
                Current Batch Information
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm text-blue-800">
                <div>
                  <span className="font-medium">Current Count:</span>{' '}
                  {selectedStocking.fish_count.toLocaleString()} fish
                </div>
                <div>
                  <span className="font-medium">Initial ABW:</span>{' '}
                  {selectedStocking.initial_abw.toFixed(1)} g
                </div>
                <div>
                  <span className="font-medium">Initial Biomass:</span>{' '}
                  {selectedStocking.initial_biomass.toFixed(1)} kg
                </div>
              </div>
              {selectedStocking.topups && selectedStocking.topups.length > 0 && (
                <div className="mt-2 text-sm text-blue-800">
                  <span className="font-medium">Previous Top-ups:</span>{' '}
                  {selectedStocking.topups.length} (
                  {selectedStocking.topups
                    .reduce((sum, t) => sum + t.fish_count, 0)
                    .toLocaleString()}{' '}
                  fish)
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Top-up Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Top-up Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                name="topup_date"
                value={formData.topup_date}
                onChange={handleChange}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                required
              />
            </div>

            {/* Fish Count */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fish Count to Add <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                name="fish_count"
                value={formData.fish_count}
                onChange={handleChange}
                min="1"
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="Number of fish to add"
                required
              />
            </div>

            {/* ABW */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Average Body Weight (g) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                name="abw"
                value={formData.abw}
                onChange={handleChange}
                step="0.1"
                min="0.1"
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="ABW in grams"
                required
              />
            </div>

            {/* Calculated Biomass */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Biomass to Add (kg)
              </label>
              <input
                type="text"
                value={calculateBiomass().toFixed(2)}
                readOnly
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-50 focus:outline-none sm:text-sm"
              />
              <p className="mt-1 text-xs text-gray-500">
                Auto-calculated: (ABW/1000) × Fish Count
              </p>
            </div>

            {/* Source Location */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Source Location
              </label>
              <input
                type="text"
                name="source_location"
                value={formData.source_location}
                onChange={handleChange}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="Where the fish were sourced from"
              />
            </div>

            {/* Transfer Supervisor */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Transfer Supervisor
              </label>
              <input
                type="text"
                name="transfer_supervisor"
                value={formData.transfer_supervisor}
                onChange={handleChange}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="Person who supervised the transfer"
              />
            </div>
          </div>

          {/* Notes */}
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
              placeholder="Any additional information about this top-up"
            ></textarea>
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => router.push('/stocking-management')}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || fetchingData}
              className={`px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                loading || fetchingData
                  ? 'bg-orange-400'
                  : 'bg-orange-600 hover:bg-orange-700'
              } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-orange-500`}
            >
              {loading ? 'Submitting...' : 'Submit Top-Up'}
            </button>
          </div>

          <div className="text-xs text-gray-500 mt-2">
            <p>
              Note: Top-up requests require admin approval before being applied.
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}

export default TopUpForm
