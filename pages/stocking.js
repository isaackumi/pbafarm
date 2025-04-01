// pages/stocking.js
import { useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import { supabase } from '../lib/supabase'
import { cageService } from '../lib/databaseService'

export default function StockingPage() {
  return (
    <ProtectedRoute>
      <NewCageForm />
    </ProtectedRoute>
  )
}

function NewCageForm() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [formData, setFormData] = useState({
    name: '',
    stockingDate: new Date().toISOString().split('T')[0],
    initialCount: '',
    initialWeight: '',
    initialABW: '',
    location: '',
    notes: '',
  })

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))

    // Auto-calculate ABW when initialWeight and initialCount are provided
    if (
      (name === 'initialWeight' || name === 'initialCount') &&
      formData.initialWeight &&
      formData.initialCount
    ) {
      const weight =
        name === 'initialWeight'
          ? parseFloat(value)
          : parseFloat(formData.initialWeight)
      const count =
        name === 'initialCount'
          ? parseInt(value)
          : parseInt(formData.initialCount)

      if (weight > 0 && count > 0) {
        // Calculate ABW in grams (initial weight in kg / count * 1000)
        const abw = ((weight / count) * 1000).toFixed(1)
        setFormData((prev) => ({ ...prev, initialABW: abw }))
      }
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')

    try {
      // Prepare data for submission
      const newCageData = {
        name: formData.name,
        stocking_date: formData.stockingDate,
        initial_count: parseInt(formData.initialCount),
        initial_weight: parseFloat(formData.initialWeight),
        initial_abw: parseFloat(formData.initialABW),
        location: formData.location,
        notes: formData.notes,
        status: 'active', // Default status for new cages
        created_at: new Date(),
      }

      // Save to database
      const { data, error } = await cageService.createCage(newCageData)

      if (error) throw error

      setMessage('Cage created successfully!')

      // Redirect to cage detail page after short delay
      setTimeout(() => {
        router.push(`/cage/${data[0].id}`)
      }, 1500)
    } catch (error) {
      console.error('Error creating cage:', error.message)
      setError(error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 font-montserrat">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6">
          <Link
            href="/cages"
            className="inline-flex items-center text-indigo-600 hover:text-indigo-800"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Cages
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">
            New Cage Stocking
          </h1>
        </div>

        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="font-medium text-gray-700">Cage Stocking Details</h2>
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
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Cage Name/Number*
                  </label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    placeholder="e.g. Cage 1"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Stocking Date*
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

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Initial Count (fish)*
                  </label>
                  <input
                    type="number"
                    name="initialCount"
                    value={formData.initialCount}
                    onChange={handleChange}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    placeholder="0"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Initial Weight (kg)*
                  </label>
                  <input
                    type="number"
                    name="initialWeight"
                    value={formData.initialWeight}
                    onChange={handleChange}
                    step="0.1"
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    placeholder="0.0"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Initial ABW (g)
                  </label>
                  <input
                    type="number"
                    name="initialABW"
                    value={formData.initialABW}
                    onChange={handleChange}
                    step="0.1"
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm bg-gray-50"
                    placeholder="0.0"
                    readOnly={formData.initialWeight && formData.initialCount}
                    required
                  />
                  {formData.initialWeight && formData.initialCount ? (
                    <p className="mt-1 text-xs text-gray-500">
                      Auto-calculated from weight and count
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-gray-500">
                      Or enter initial weight and count to auto-calculate
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Location
                  </label>
                  <input
                    type="text"
                    name="location"
                    value={formData.location}
                    onChange={handleChange}
                    className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    placeholder="e.g. Pond 1, Bay 3, etc."
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
                  placeholder="Optional notes about stocking, source, etc."
                ></textarea>
              </div>

              <div>
                <button
                  type="submit"
                  disabled={loading}
                  className={`w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                    loading
                      ? 'bg-indigo-400'
                      : 'bg-indigo-600 hover:bg-indigo-700'
                  } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500`}
                >
                  {loading ? 'Creating...' : 'Create New Cage'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
