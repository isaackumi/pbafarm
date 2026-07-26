// Stub component for StockingForm
import React, { useState, useEffect } from 'react'
import { cageService } from '../lib/cageService'
import stockingService from '../lib/stockingService'

const StockingForm = ({ onSuccess, onCancel }) => {
  const [cages, setCages] = useState([])
  const [formData, setFormData] = useState({
    cageId: '',
    batchNumber: '',
    stockingDate: new Date().toISOString().split('T')[0],
    fishCount: '',
    averageBodyWeight: '',
    sourceLocation: '',
    transferSupervisor: '',
    samplingSupervisor: '',
    notes: ''
  })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadCages()
  }, [])

  const loadCages = async () => {
    try {
      const response = await cageService.getAllCages()
      if (response.data) {
        // Filter for available cages (empty, fallow, harvested)
        const availableCages = response.data.filter(cage => 
          ['empty', 'fallow', 'harvested'].includes(cage.status)
        )
        setCages(availableCages)
      }
    } catch (error) {
      console.error('Error loading cages:', error)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    try {
      setLoading(true)
      
      const stockingData = {
        cage_id: formData.cageId,
        batch_number: formData.batchNumber,
        stocking_date: formData.stockingDate,
        fish_count: parseInt(formData.fishCount),
        initial_abw: parseFloat(formData.averageBodyWeight),
        source_location: formData.sourceLocation,
        transfer_supervisor: formData.transferSupervisor,
        sampling_supervisor: formData.samplingSupervisor,
        notes: formData.notes
      }

      const response = await stockingService.createStocking(stockingData)
      
      if (response.error) {
        throw response.error
      }

      alert('Stocking record created successfully!')
      if (onSuccess) onSuccess()
    } catch (error) {
      console.error('Error creating stocking record:', error)
      alert('Error creating stocking record: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData({
      ...formData,
      [name]: value
    })
  }

  return (
    <div className="max-w-2xl mx-auto bg-white p-6 rounded-lg shadow">
      <h2 className="text-2xl font-bold mb-6">New Stocking Entry</h2>
      
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Select Cage</label>
          <select
            name="cageId"
            value={formData.cageId}
            onChange={handleChange}
            className="w-full border rounded px-3 py-2"
            required
          >
            <option value="">Choose available cage...</option>
            {cages.map(cage => (
              <option key={cage._id} value={cage._id}>
                {cage.name} - {cage.status}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-2">Batch Number</label>
            <input
              type="text"
              name="batchNumber"
              value={formData.batchNumber}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Stocking Date</label>
            <input
              type="date"
              name="stockingDate"
              value={formData.stockingDate}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
              required
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-2">Fish Count</label>
            <input
              type="number"
              name="fishCount"
              value={formData.fishCount}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
              min="1"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Average Body Weight (g)</label>
            <input
              type="number"
              name="averageBodyWeight"
              step="0.1"
              value={formData.averageBodyWeight}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
              min="0"
              required
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Source Location</label>
          <input
            type="text"
            name="sourceLocation"
            value={formData.sourceLocation}
            onChange={handleChange}
            className="w-full border rounded px-3 py-2"
          />
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-2">Transfer Supervisor</label>
            <input
              type="text"
              name="transferSupervisor"
              value={formData.transferSupervisor}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Sampling Supervisor</label>
            <input
              type="text"
              name="samplingSupervisor"
              value={formData.samplingSupervisor}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Notes</label>
          <textarea
            name="notes"
            value={formData.notes}
            onChange={handleChange}
            className="w-full border rounded px-3 py-2"
            rows="3"
          />
        </div>
        
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={loading}
            className="bg-lagoon-800 text-white px-4 py-2 rounded hover:bg-lagoon-800 disabled:opacity-50"
          >
            {loading ? 'Creating...' : 'Create Stocking Record'}
          </button>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="bg-foam-deep/400 text-white px-4 py-2 rounded hover:bg-gray-600"
            >
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  )
}

export default StockingForm