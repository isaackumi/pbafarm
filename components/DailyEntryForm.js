// components/DailyEntryForm.js (Fixed - Using cages_info table)
import React, { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { feedTypeService } from '../lib/feedTypeService'

const DailyEntryForm = ({ cage }) => {
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    feed_amount: '',
    feed_type_id: '',
    feed_price: '1.50',
    mortality: '0',
    notes: '',
  })
  const [recentRecords, setRecentRecords] = useState([])
  const [feedTypes, setFeedTypes] = useState([])
  const [lastUsedFeedType, setLastUsedFeedType] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  // If no cage is provided, show a message
  if (!cage) {
    return (
      <div className="bg-white shadow rounded-lg p-8">
        <p className="text-center text-gray-600">Please select a cage first</p>
      </div>
    )
  }

  // Fetch cage, recent records and feed types
  useEffect(() => {
    if (!cage) {
      setLoading(false)
      return
    }

    async function fetchData() {
      try {
        // Fetch recent records
        const { data: recordsData, error: recordsError } = await supabase
          .from('daily_records')
          .select(
            `
            *,
            feed_types(*)
          `,
          )
          .eq('cage_id', cage.id)
          .order('date', { ascending: false })
          .limit(10)

        if (recordsError) throw recordsError
        setRecentRecords(recordsData || [])

        // Fetch feed types
        const {
          data: feedTypesData,
          error: feedTypesError,
        } = await feedTypeService.getActiveFeedTypes()

        if (feedTypesError) throw feedTypesError
        setFeedTypes(feedTypesData || [])

        // Get last used feed type for this cage
        const lastFeedType = await feedTypeService.getLastUsedFeedType(cage.id)

        // Set default feed price from the most recent record if available
        if (recordsData && recordsData.length > 0) {
          setFormData((prev) => ({
            ...prev,
            feed_price:
              recordsData[0].feed_price?.toString() || prev.feed_price,
            feed_type_id: lastFeedType
              ? lastFeedType.id
              : feedTypesData && feedTypesData.length > 0
              ? feedTypesData[0].id
              : '',
          }))

          if (lastFeedType) {
            setLastUsedFeedType(lastFeedType)
          }
        } else if (feedTypesData && feedTypesData.length > 0) {
          // If no recent records, still set a default feed type if available
          setFormData((prev) => ({
            ...prev,
            feed_type_id: feedTypesData[0].id,
          }))
        }
      } catch (error) {
        setError('Failed to load cage data: ' + error.message)
      } finally {
        setLoading(false)
      }
    }

    fetchData()

    // Reset form when cage changes
    setFormData({
      date: new Date().toISOString().split('T')[0],
      feed_amount: '',
      feed_type_id: '',
      feed_price: '1.50',
      mortality: '0',
      notes: '',
    })
    setMessage('')
    setError('')
  }, [cage])

  // Add validation for date before stocking date
  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => {
      const newFormData = { ...prev, [name]: value }
      
      // Check if the date is before stocking date
      if (name === 'date' && cage && cage.stocking_date) {
        const selectedDate = new Date(value)
        const stockingDate = new Date(cage.stocking_date)
        
        if (selectedDate < stockingDate) {
          setError(`Cannot enter data before stocking date (${cage.stocking_date}). This cage was not active before that date.`)
          return prev // Keep the old date
        } else {
          setError('') // Clear any previous error
        }
      }
      
      return newFormData
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    setMessage('')

    try {
      // Validate input
      if (!formData.feed_amount || parseFloat(formData.feed_amount) <= 0) {
        throw new Error('Please enter a valid feed amount')
      }

      if (!formData.feed_price || parseFloat(formData.feed_price) <= 0) {
        throw new Error('Please enter a valid feed price')
      }

      if (!formData.feed_type_id) {
        throw new Error('Please select a feed type')
      }

      // Check if the date is before stocking date
      if (cage && cage.stocking_date) {
        const selectedDate = new Date(formData.date)
        const stockingDate = new Date(cage.stocking_date)
        
        if (selectedDate < stockingDate) {
          throw new Error(`Cannot enter data before stocking date (${cage.stocking_date}). This cage was not active before that date.`)
        }
      }

      // Check for duplicate entry on the same date
      const { data: existingRecord, error: checkError } = await supabase
        .from('daily_records')
        .select('id')
        .eq('cage_id', cage.id)
        .eq('date', formData.date)
        .maybeSingle()

      if (checkError) throw checkError

      if (existingRecord) {
        throw new Error(
          'A record already exists for this date. Please choose a different date or update the existing record.',
        )
      }

      // Calculate feed cost
      const calculatedFeedCost = calculateFeedCost()

      // Save to Supabase
      const { data, error } = await supabase.from('daily_records').insert([
        {
          cage_id: cage.id,
          date: formData.date,
          feed_amount: parseFloat(formData.feed_amount),
          feed_type_id: formData.feed_type_id,
          feed_price: parseFloat(formData.feed_price),
          feed_cost: parseFloat(calculatedFeedCost),
          mortality: parseInt(formData.mortality),
          notes: formData.notes,
        },
      ])

      if (error) throw error

      // Success message
      setMessage('Record saved successfully!')

      // Refresh recent records
      const { data: newRecords, error: fetchError } = await supabase
        .from('daily_records')
        .select(
          `
          *,
          feed_types(*)
        `,
        )
        .eq('cage_id', cage.id)
        .order('date', { ascending: false })
        .limit(10)

      if (fetchError) throw fetchError
      setRecentRecords(newRecords || [])

      // Reset form (except date, feed type and price)
      setFormData({
        date: formData.date,
        feed_amount: '',
        feed_type_id: formData.feed_type_id, // Keep the same feed type for next entry
        feed_price: formData.feed_price,
        mortality: '0',
        notes: '',
      })
    } catch (error) {
      console.error('Error saving record:', error.message)
      setError(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  // Calculate feed cost based on amount and price
  const calculateFeedCost = () => {
    if (!formData.feed_amount || !formData.feed_price) return 0

    const amount = parseFloat(formData.feed_amount)
    const price = parseFloat(formData.feed_price)

    return (amount * price).toFixed(2)
  }

  const feedCost = calculateFeedCost()

  // Get feed type name to display in the table
  const getFeedTypeName = (record) => {
    if (record.feed_types) {
      return record.feed_types.name
    }

    // Fallback for old records without feed_type_id
    return record.feed_type || 'Unknown'
  }

  if (loading) {
    return (
      <div className="bg-white shadow rounded-lg p-8">
        <div className="flex justify-center items-center h-32">
          <div className="w-8 h-8 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="ml-2 text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white shadow rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="font-medium text-gray-700">
          Daily Data Entry - {cage.name} <span className="text-xs text-gray-500">({cage.code})</span>
        </h2>
        <div className="text-xs text-gray-500">Location: {cage.location || 'N/A'} | Capacity: {cage.capacity || 'N/A'}</div>
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Date
              </label>
              <input
                type="date"
                name="date"
                value={formData.date}
                onChange={handleChange}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Feed Amount (kg)
              </label>
              <input
                type="number"
                name="feed_amount"
                value={formData.feed_amount}
                onChange={handleChange}
                step="0.1"
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="0.0"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Feed Type
              </label>
              <select
                name="feed_type_id"
                value={formData.feed_type_id}
                onChange={handleChange}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                required
              >
                <option value="">Select a feed type</option>
                {feedTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </select>
              {lastUsedFeedType && (
                <p className="mt-1 text-xs text-gray-500">
                  Last used: {lastUsedFeedType.name}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Feed Price/kg (GHc)
              </label>
              <input
                type="number"
                name="feed_price"
                value={formData.feed_price}
                onChange={handleChange}
                step="0.01"
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Feed Cost (GHc)
              </label>
              <input
                type="text"
                value={feedCost}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm bg-gray-50 focus:outline-none sm:text-sm"
                readOnly
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Mortality (fish count)
              </label>
              <input
                type="number"
                name="mortality"
                value={formData.mortality}
                onChange={handleChange}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                min="0"
                required
              />
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
              placeholder="Optional notes about today's feeding, conditions, etc."
            ></textarea>
          </div>

          <div>
            <button
              type="submit"
              disabled={submitting}
              className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                submitting
                  ? 'bg-indigo-400'
                  : 'bg-indigo-600 hover:bg-indigo-700'
              } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500`}
            >
              {submitting ? 'Saving...' : 'Save Daily Record'}
            </button>
          </div>
        </form>
      </div>

      <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
        <h3 className="text-sm font-medium text-gray-700 mb-4">
          Recent Daily Records
        </h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-100">
              <tr>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Date
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Feed (kg)
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Feed Type
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Cost
                </th>
                <th
                  scope="col"
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  Mortality
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {recentRecords.length > 0 ? (
                recentRecords.map((record) => (
                  <tr key={record.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {record.date}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {record.feed_amount}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {getFeedTypeName(record)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      ${(record.feed_cost || 0).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {record.mortality}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td
                    colSpan="5"
                    className="px-6 py-4 text-center text-sm text-gray-500"
                  >
                    No recent records found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default DailyEntryForm
