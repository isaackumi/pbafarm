// Stub component for DailyUploadPage  
import React, { useState, useEffect } from 'react'
import { cageService } from '../lib/cageService'
import { dailyRecordService } from '../lib/databaseService'

const DailyUploadPage = () => {
  const [cages, setCages] = useState([])
  const [selectedCage, setSelectedCage] = useState('')
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    mortalityCount: 0,
    feedAmount: 0,
    feedType: '',
    waterTemperature: '',
    phLevel: '',
    dissolvedOxygen: '',
    weatherCondition: '',
    notes: ''
  })
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    loadCages()
  }, [])

  const loadCages = async () => {
    try {
      const response = await cageService.getActiveCages()
      if (response.data) {
        setCages(response.data)
      }
    } catch (error) {
      console.error('Error loading cages:', error)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!selectedCage) {
      alert('Please select a cage')
      return
    }

    try {
      setLoading(true)
      
      const recordData = {
        cage_id: selectedCage,
        ...formData
      }

      const response = await dailyRecordService.createDailyRecord(recordData)
      
      if (response.error) {
        throw response.error
      }

      alert('Daily record created successfully!')
      setFormData({
        date: new Date().toISOString().split('T')[0],
        mortalityCount: 0,
        feedAmount: 0,
        feedType: '',
        waterTemperature: '',
        phLevel: '',
        dissolvedOxygen: '',
        weatherCondition: '',
        notes: ''
      })
    } catch (error) {
      console.error('Error creating daily record:', error)
      alert('Error creating daily record: ' + error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    const { name, value, type } = e.target
    setFormData({
      ...formData,
      [name]: type === 'number' ? parseFloat(value) || 0 : value
    })
  }

  return (
    <div className="max-w-2xl mx-auto bg-white p-6 rounded-lg shadow">
      <h2 className="text-2xl font-bold mb-6">Daily Record Entry</h2>
      
      <form onSubmit={handleSubmit}>
        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Select Cage</label>
          <select
            value={selectedCage}
            onChange={(e) => setSelectedCage(e.target.value)}
            className="w-full border rounded px-3 py-2"
            required
          >
            <option value="">Choose a cage...</option>
            {cages.map(cage => (
              <option key={cage._id} value={cage._id}>
                {cage.name} - {cage.status}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-2">Date</label>
            <input
              type="date"
              name="date"
              value={formData.date}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Mortality Count</label>
            <input
              type="number"
              name="mortalityCount"
              value={formData.mortalityCount}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
              min="0"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-2">Feed Amount (kg)</label>
            <input
              type="number"
              name="feedAmount"
              step="0.1"
              value={formData.feedAmount}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
              min="0"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Feed Type</label>
            <input
              type="text"
              name="feedType"
              value={formData.feedType}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium mb-2">Water Temp (°C)</label>
            <input
              type="number"
              name="waterTemperature"
              step="0.1"
              value={formData.waterTemperature}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">pH Level</label>
            <input
              type="number"
              name="phLevel"
              step="0.1"
              value={formData.phLevel}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
              min="0"
              max="14"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Dissolved O2 (mg/L)</label>
            <input
              type="number"
              name="dissolvedOxygen"
              step="0.1"
              value={formData.dissolvedOxygen}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium mb-2">Weather Condition</label>
          <select
            name="weatherCondition"
            value={formData.weatherCondition}
            onChange={handleChange}
            className="w-full border rounded px-3 py-2"
          >
            <option value="">Select weather...</option>
            <option value="sunny">Sunny</option>
            <option value="cloudy">Cloudy</option>
            <option value="rainy">Rainy</option>
            <option value="stormy">Stormy</option>
          </select>
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
        
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? 'Creating Record...' : 'Create Daily Record'}
        </button>
      </form>
    </div>
  )
}

export default DailyUploadPage