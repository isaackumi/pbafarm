// components/StockingForm.js
import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../lib/supabase'

const StockingForm = () => {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [fetchingData, setFetchingData] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [availableCages, setAvailableCages] = useState([])
  const [existingStockings, setExistingStockings] = useState({})
  const [allCages, setAllCages] = useState([]) // Store all cages for reference
  const [formData, setFormData] = useState({
    cageId: '',
    batchNumber: '',
    stockingDate: new Date().toISOString().split('T')[0],
    fishCount: '',
    initialABW: '',
    initialBiomass: '',
    sourceLocation: '',
    sourceCage: '',
    transferSupervisor: '',
    samplingSupervisor: '',
  })

  // Fetch available cages and previous stockings
  useEffect(() => {
    async function fetchData() {
      setFetchingData(true)
      try {
        console.log('Fetching cage data...')

        // Fetch all cages first
        const {
          data: allCagesData,
          error: allCagesError,
        } = await supabase
          .from('cages')
          .select('id, name, status')
          .order('name')

        if (allCagesError) {
          console.error('Error fetching all cages:', allCagesError)
          throw allCagesError
        }

        // Store all cages for reference
        console.log('All cages fetched:', allCagesData)
        setAllCages(allCagesData || [])

        // Filter to show only available cages
        // Note: In a real database these statuses would already exist
        // If they don't exist yet, this will show all cages
        const availableCagesList =
          allCagesData.filter(
            (cage) =>
              !cage.status ||
              cage.status === 'fallow' ||
              cage.status === 'empty' ||
              cage.status === 'harvested',
          ) || []
        console.log('Available cages:', availableCagesList)
        setAvailableCages(availableCagesList)

        // Get the current year
        const currentYear = new Date().getFullYear().toString()
        const yearSuffix = currentYear.slice(-2) // Get last 2 digits
        console.log('Current year:', currentYear, 'Year suffix:', yearSuffix)

        // Check if stocking_history table exists, if not use a fallback approach
        const {
          data: stockingsData,
          error: stockingsError,
        } = await supabase
          .from('stocking_history')
          .select('cage_id, stocking_date')
          .gte('stocking_date', `${currentYear}-01-01`)

        // Process stocking data to determine next batch number for each cage
        const stockingCounts = {}

        if (stockingsError) {
          console.warn(
            'Stocking history table might not exist yet:',
            stockingsError,
          )
          // Fallback: If stocking_history table doesn't exist yet, check active cages
          allCagesData.forEach((cage) => {
            if (cage.status === 'active') {
              stockingCounts[cage.id] = 1
            }
          })
        } else if (stockingsData) {
          console.log('Stocking history data:', stockingsData)
          stockingsData.forEach((stock) => {
            if (!stockingCounts[stock.cage_id]) {
              stockingCounts[stock.cage_id] = 1
            } else {
              stockingCounts[stock.cage_id]++
            }
          })
        }

        console.log('Stocking counts:', stockingCounts)
        setExistingStockings(stockingCounts)
      } catch (error) {
        console.error('Error fetching data:', error.message)
        setError('Failed to load cage data. Please try again.')
      } finally {
        setFetchingData(false)
      }
    }

    fetchData()
  }, [])

  // Auto-calculate initial biomass when fish count or ABW changes
  useEffect(() => {
    if (formData.fishCount && formData.initialABW) {
      const count = parseFloat(formData.fishCount)
      const abw = parseFloat(formData.initialABW)

      if (!isNaN(count) && !isNaN(abw)) {
        // Calculate biomass in kg (ABW in grams / 1000 * count)
        const biomass = (abw / 1000) * count
        setFormData((prev) => ({
          ...prev,
          initialBiomass: biomass.toFixed(2),
        }))
      }
    }
  }, [formData.fishCount, formData.initialABW])

  // Auto-generate batch number when cage is selected
  const handleCageSelect = (cageId) => {
    console.log('Cage selected:', cageId)
    const selectedCage = allCages.find((cage) => cage.id === cageId)
    if (selectedCage) {
      const cageName = selectedCage.name
      const currentYear = new Date().getFullYear().toString().slice(-2) // Last 2 digits of year
      const stockingCount = existingStockings[cageId]
        ? existingStockings[cageId] + 1
        : 1

      // Format: C1/125 (Cage 1, first stocking in year '25)
      const batchNumber = `${cageName}/${stockingCount}${currentYear}`
      console.log('Generated batch number:', batchNumber)

      setFormData((prev) => ({
        ...prev,
        cageId: cageId,
        batchNumber: batchNumber,
      }))
    } else {
      console.warn('Selected cage not found in allCages array')
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')

    try {
      // Validate required fields
      if (
        !formData.cageId ||
        !formData.stockingDate ||
        !formData.fishCount ||
        !formData.initialABW ||
        !formData.initialBiomass
      ) {
        throw new Error('Please fill in all required fields')
      }

      // Check if the cage is already active (prevent double stocking)
      const { data: cageData, error: cageCheckError } = await supabase
        .from('cages')
        .select('status')
        .eq('id', formData.cageId)
        .single()

      if (cageCheckError) throw cageCheckError

      if (cageData && cageData.status === 'active') {
        throw new Error(
          'This cage is already stocked and active. Please select a different cage.',
        )
      }

      // Create stocking record
      const stockingData = {
        cage_id: formData.cageId,
        batch_number: formData.batchNumber,
        stocking_date: formData.stockingDate,
        fish_count: parseInt(formData.fishCount),
        initial_abw: parseFloat(formData.initialABW),
        initial_biomass: parseFloat(formData.initialBiomass),
        source_location: formData.sourceLocation,
        source_cage: formData.sourceCage,
        transfer_supervisor: formData.transferSupervisor,
        sampling_supervisor: formData.samplingSupervisor,
      }

      console.log('Saving stocking data:', stockingData)

      // First, try to create the stocking_history table if it doesn't exist
      try {
        // This is a simplified approach for demonstration
        // In a production app, you'd have proper database migrations
        await supabase.rpc('create_stocking_history_if_not_exists')
      } catch (tableError) {
        console.warn(
          'Error creating stocking_history table (might already exist):',
          tableError,
        )
        // Continue with the process
      }

      // Insert into stocking history
      const {
        data: insertedStocking,
        error: stockingError,
      } = await supabase
        .from('stocking_history')
        .insert([stockingData])
        .select()

      if (stockingError) {
        console.error('Error inserting stocking history:', stockingError)

        // Fallback: If stocking_history table doesn't exist yet, just update the cage
        console.log(
          'Falling back to just updating the cage without stocking history',
        )
      }

      // Update cage status to active
      const { data: updatedCage, error: updateError } = await supabase
        .from('cages')
        .update({
          status: 'active',
          stocking_date: formData.stockingDate,
          initial_count: parseInt(formData.fishCount),
          initial_abw: parseFloat(formData.initialABW),
          initial_biomass: parseFloat(formData.initialBiomass),
        })
        .eq('id', formData.cageId)
        .select()

      if (updateError) {
        console.error('Error updating cage:', updateError)
        throw updateError
      }

      console.log('Cage updated successfully:', updatedCage)
      setMessage('Cage stocked successfully!')

      // Reset form
      setFormData({
        cageId: '',
        batchNumber: '',
        stockingDate: new Date().toISOString().split('T')[0],
        fishCount: '',
        initialABW: '',
        initialBiomass: '',
        sourceLocation: '',
        sourceCage: '',
        transferSupervisor: '',
        samplingSupervisor: '',
      })

      // Refresh available cages
      const { data: refreshedCages, error: refreshError } = await supabase
        .from('cages')
        .select('id, name, status')
        .order('name')

      if (!refreshError && refreshedCages) {
        setAllCages(refreshedCages)
        setAvailableCages(
          refreshedCages.filter(
            (cage) =>
              !cage.status ||
              cage.status === 'fallow' ||
              cage.status === 'empty' ||
              cage.status === 'harvested',
          ),
        )
      }

      // Redirect to cages page after a delay
      setTimeout(() => {
        router.push('/cages')
      }, 2000)
    } catch (error) {
      console.error('Error stocking cage:', error.message)
      setError(error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white shadow rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="font-medium text-gray-700">New Cage Stocking</h2>
      </div>

      <div className="p-6">
        {error && (
          <div className="mb-4 bg-red-50 text-red-800 p-4 rounded-md">
            {error}
          </div>
        )}

        {message && (
          <div className="mb-4 bg-green-50 text-green-800 p-4 rounded-md">
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Cage Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Cage <span className="text-red-500">*</span>
              </label>
              {fetchingData ? (
                <div className="flex items-center space-x-2 h-10">
                  <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-sm text-gray-500">
                    Loading cages...
                  </span>
                </div>
              ) : (
                <>
                  <select
                    name="cageId"
                    value={formData.cageId}
                    onChange={(e) => handleCageSelect(e.target.value)}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    required
                    disabled={availableCages.length === 0}
                  >
                    <option value="">Select a cage</option>
                    {availableCages.map((cage) => (
                      <option key={cage.id} value={cage.id}>
                        {cage.name} {cage.status ? `(${cage.status})` : ''}
                      </option>
                    ))}
                  </select>
                  {availableCages.length === 0 && !fetchingData && (
                    <p className="mt-1 text-xs text-red-500">
                      No available cages found. All cages might currently be
                      active.
                    </p>
                  )}
                </>
              )}
              <p className="mt-1 text-xs text-gray-500">
                Only showing cages that are available for stocking.
              </p>
            </div>

            {/* Batch Number - Auto-generated but editable */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Batch Number <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="batchNumber"
                value={formData.batchNumber}
                onChange={handleChange}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-gray-50"
                readOnly
                required
              />
              <p className="mt-1 text-xs text-gray-500">
                Auto-generated: Cage/StockingNo.Year
              </p>
            </div>

            {/* Stocking Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Stocking Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                name="stockingDate"
                value={formData.stockingDate}
                onChange={handleChange}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                required
              />
            </div>

            {/* Fish Count */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Fish Count <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                name="fishCount"
                value={formData.fishCount}
                onChange={handleChange}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="Number of fish"
                required
              />
            </div>

            {/* Initial ABW */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Initial ABW (g) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                name="initialABW"
                value={formData.initialABW}
                onChange={handleChange}
                step="0.1"
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="Average Body Weight in grams"
                required
              />
            </div>

            {/* Initial Biomass - Auto-calculated */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Initial Biomass (kg) <span className="text-red-500">*</span>
              </label>
              <input
                type="number"
                name="initialBiomass"
                value={formData.initialBiomass}
                onChange={handleChange}
                step="0.01"
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-gray-50"
                placeholder="0.00"
                readOnly
                required
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
                name="sourceLocation"
                value={formData.sourceLocation}
                onChange={handleChange}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="Where the fish were sourced from"
              />
            </div>

            {/* Source Cage */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Source Cage
              </label>
              <input
                type="text"
                name="sourceCage"
                value={formData.sourceCage}
                onChange={handleChange}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="Original cage identifier"
              />
            </div>

            {/* Transfer Supervisor */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Transfer Supervisor
              </label>
              <input
                type="text"
                name="transferSupervisor"
                value={formData.transferSupervisor}
                onChange={handleChange}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="Person who supervised the transfer"
              />
            </div>

            {/* Sampling Supervisor */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Sampling Supervisor
              </label>
              <input
                type="text"
                name="samplingSupervisor"
                value={formData.samplingSupervisor}
                onChange={handleChange}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="Person who supervised the sampling"
              />
            </div>
          </div>

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={() => router.push('/cages')}
              className="px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className={`px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                loading ? 'bg-indigo-400' : 'bg-indigo-600 hover:bg-indigo-700'
              } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500`}
            >
              {loading ? 'Saving...' : 'Stock Cage'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default StockingForm
