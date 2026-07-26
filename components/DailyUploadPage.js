import React, { useState, useEffect } from 'react'
import { cageService } from '../lib/cageService'
import { feedTypeService } from '../lib/feedTypeService'
import { dailyRecordService } from '../lib/databaseService'

const DailyUploadPage = () => {
  const [cages, setCages] = useState([])
  const [feedTypes, setFeedTypes] = useState([])
  const [selectedCage, setSelectedCage] = useState('')
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    mortalityCount: 0,
    feedAmount: 0,
    feedTypeId: '',
    feedPrice: 0,
    notes: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    loadLookups()
  }, [])

  const loadLookups = async () => {
    try {
      const [cageRes, feedRes] = await Promise.all([
        cageService.getActiveCages(),
        feedTypeService.getAllFeedTypes(),
      ])
      if (cageRes.data) setCages(cageRes.data)
      if (feedRes.data) setFeedTypes(feedRes.data)
    } catch (err) {
      console.error('Error loading lookups:', err)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (!selectedCage) {
      setError('Please select a cage')
      return
    }
    const feedAmount = Number(formData.feedAmount) || 0
    if (feedAmount > 0 && !formData.feedTypeId) {
      setError('Feed type is required when feed amount > 0')
      return
    }

    try {
      setLoading(true)
      const selectedFeed = feedTypes.find(
        (f) => (f.id || f._id) === formData.feedTypeId,
      )
      const feedPrice =
        Number(formData.feedPrice) ||
        Number(selectedFeed?.price_per_kg || selectedFeed?.pricePerKg || 0)

      const response = await dailyRecordService.createDailyRecord({
        cage_id: selectedCage,
        cageId: selectedCage,
        date: formData.date,
        feed_amount: feedAmount,
        feedAmount,
        feed_type_id: formData.feedTypeId || undefined,
        feedTypeId: formData.feedTypeId || undefined,
        feed_price: feedPrice,
        feedPrice,
        feed_cost: feedAmount * feedPrice,
        feedCost: feedAmount * feedPrice,
        mortality: Number(formData.mortalityCount) || 0,
        notes: formData.notes || undefined,
      })

      if (response.error) throw response.error

      setFormData({
        date: new Date().toISOString().split('T')[0],
        mortalityCount: 0,
        feedAmount: 0,
        feedTypeId: '',
        feedPrice: 0,
        notes: '',
      })
      alert('Daily record created — stock updated on ledger')
    } catch (err) {
      console.error('Error creating daily record:', err)
      setError(err.message || 'Error creating daily record')
    } finally {
      setLoading(false)
    }
  }

  const handleChange = (e) => {
    const { name, value, type } = e.target
    setFormData({
      ...formData,
      [name]: type === 'number' ? parseFloat(value) || 0 : value,
    })
  }

  return (
    <div className="max-w-2xl mx-auto bg-white p-6 rounded-lg shadow">
      <h2 className="text-2xl font-bold mb-2 text-chart-ink">Daily Record Entry</h2>
      <p className="text-sm text-muted mb-6">
        Feed amounts deduct stock through the inventory ledger.
      </p>

      {error && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 rounded p-3">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">Select Cage</label>
          <select
            value={selectedCage}
            onChange={(e) => setSelectedCage(e.target.value)}
            className="w-full border rounded px-3 py-2"
            required
          >
            <option value="">Choose a cage…</option>
            {cages.map((cage) => (
              <option key={cage._id || cage.id} value={cage._id || cage.id}>
                {cage.name} — {cage.status}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
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
            <label className="block text-sm font-medium mb-2">Mortality</label>
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

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">Feed type</label>
            <select
              name="feedTypeId"
              value={formData.feedTypeId}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2"
            >
              <option value="">Select…</option>
              {feedTypes.map((f) => (
                <option key={f.id || f._id} value={f.id || f._id}>
                  {f.name} ({Number(f.current_stock).toFixed(1)} kg)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Feed amount (kg)</label>
            <input
              type="number"
              name="feedAmount"
              step="0.1"
              value={formData.feedAmount}
              onChange={handleChange}
              className="w-full border rounded px-3 py-2 font-mono"
              min="0"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">Notes</label>
          <textarea
            name="notes"
            value={formData.notes}
            onChange={handleChange}
            className="w-full border rounded px-3 py-2"
            rows={3}
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-lagoon-800 text-white py-2 rounded hover:bg-lagoon-950 disabled:opacity-60"
        >
          {loading ? 'Saving…' : 'Save daily record'}
        </button>
      </form>
    </div>
  )
}

export default DailyUploadPage
