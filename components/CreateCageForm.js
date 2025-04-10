// components/CreateCageForm.js (Fixed)
import React, { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import { cageService } from '../lib/databaseService'

const CreateCageForm = () => {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [checkingName, setCheckingName] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [nameError, setNameError] = useState('')
  const [existingCages, setExistingCages] = useState([])
  const [formData, setFormData] = useState({
    name: '',
    location: '',
    size: '',
    capacity: '',
    dimensions: '',
    material: '',
    installation_date: '',
    notes: '',
    status: 'empty',
  })

  // Fetch existing cages to check for name uniqueness
  useEffect(() => {
    async function fetchExistingCages() {
      try {
        // Ensure tables exist and fetch all cages
        const { data, error } = await cageService.getAllCages()

        if (error) throw error

        setExistingCages(data || [])
      } catch (error) {
        console.error('Error fetching existing cages:', error)
      }
    }

    fetchExistingCages()
  }, [])

  // Check if cage name already exists when name field changes
  useEffect(() => {
    // Clear previous name error
    setNameError('')

    // Skip check if name is empty
    if (!formData.name) return

    // Debounce check to avoid excessive validation
    const timer = setTimeout(() => {
      const nameExists = existingCages.some(
        (cage) => cage.name.toLowerCase() === formData.name.toLowerCase(),
      )

      if (nameExists) {
        setNameError(
          'This cage name already exists. Please choose a unique name.',
        )
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [formData.name, existingCages])

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
      if (!formData.name) {
        throw new Error('Cage name is required')
      }

      // Check for name uniqueness
      const nameExists = existingCages.some(
        (cage) => cage.name.toLowerCase() === formData.name.toLowerCase(),
      )

      if (nameExists) {
        throw new Error(
          'This cage name already exists. Please choose a unique name.',
        )
      }

      // Prepare cage data with correct types
      const cageData = {
        name: formData.name.trim(),
        location: formData.location ? formData.location.trim() : null,
        size: formData.size ? parseFloat(formData.size) : null,
        capacity: formData.capacity ? parseInt(formData.capacity) : null,
        dimensions: formData.dimensions ? formData.dimensions.trim() : null,
        material: formData.material ? formData.material.trim() : null,
        installation_date: formData.installation_date || null,
        notes: formData.notes ? formData.notes.trim() : null,
        status: formData.status || 'empty',
      }

      console.log('Creating cage with data:', cageData)

      // Create cage
      const { data, error: createError } = await cageService.createCage(
        cageData,
      )

      if (createError) {
        throw createError
      }

      console.log('Cage created successfully:', data)
      setMessage('Cage created successfully!')

      // Reset form
      setFormData({
        name: '',
        location: '',
        size: '',
        capacity: '',
        dimensions: '',
        material: '',
        installation_date: '',
        notes: '',
        status: 'empty',
      })

      // Navigate to cages page after delay
      setTimeout(() => {
        router.push('/cages')
      }, 2000)
    } catch (error) {
      console.error('Error creating cage:', error)
      setError(error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white shadow rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="font-medium text-gray-700">Create New Cage</h2>
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
            {/* Cage Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Cage Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                className={`block w-full px-3 py-2 border ${
                  nameError ? 'border-red-300' : 'border-gray-300'
                } rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm`}
                placeholder="e.g., C1, Cage 2, etc."
                required
              />
              {nameError && (
                <p className="mt-1 text-sm text-red-600">{nameError}</p>
              )}
            </div>

            {/* Location */}
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
                placeholder="e.g., North Pond, Section A, etc."
              />
            </div>

            {/* Size */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Size (m³)
              </label>
              <input
                type="number"
                name="size"
                value={formData.size}
                onChange={handleChange}
                step="0.1"
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="Volume in cubic meters"
              />
            </div>

            {/* Capacity */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Capacity (fish count)
              </label>
              <input
                type="number"
                name="capacity"
                value={formData.capacity}
                onChange={handleChange}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="Maximum fish capacity"
              />
            </div>

            {/* Dimensions */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Dimensions
              </label>
              <input
                type="text"
                name="dimensions"
                value={formData.dimensions}
                onChange={handleChange}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="e.g., 5m x 5m x 3m"
              />
            </div>

            {/* Material */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Material
              </label>
              <input
                type="text"
                name="material"
                value={formData.material}
                onChange={handleChange}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                placeholder="e.g., HDPE, Metal frame, etc."
              />
            </div>

            {/* Installation Date */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Installation Date
              </label>
              <input
                type="date"
                name="installation_date"
                value={formData.installation_date}
                onChange={handleChange}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
              />
            </div>

            {/* Status */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <select
                name="status"
                value={formData.status}
                onChange={handleChange}
                className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                required
              >
                <option value="empty">Empty</option>
                <option value="maintenance">Maintenance</option>
                <option value="fallow">Fallow</option>
              </select>
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
              placeholder="Optional notes about the cage"
            ></textarea>
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
              disabled={loading || nameError}
              className={`px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white ${
                loading || nameError
                  ? 'bg-indigo-400 cursor-not-allowed'
                  : 'bg-indigo-600 hover:bg-indigo-700'
              } focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500`}
            >
              {loading ? 'Creating...' : 'Create Cage'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default CreateCageForm
