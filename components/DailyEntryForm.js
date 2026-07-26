import React, { useState, useEffect } from 'react'
import { getConvexHttpClient, api } from '../lib/convexBridge'
import { feedTypeService } from '../lib/feedTypeService'

export default function DailyEntryForm({ cageId, onSubmit, onCancel }) {
  const [feedTypes, setFeedTypes] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    mortality: 0,
    feedAmount: 0,
    feedTypeId: '',
    feedPrice: 0,
    notes: '',
  })

  useEffect(() => {
    feedTypeService.getActiveFeedTypes().then(({ data }) => setFeedTypes(data || []))
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!cageId) {
      setError('Cage is required')
      return
    }
    const feedAmount = Number(formData.feedAmount) || 0
    if (feedAmount > 0 && !formData.feedTypeId) {
      setError('Feed type is required when feed amount is greater than zero')
      return
    }
    setSaving(true)
    setError('')
    try {
      const client = getConvexHttpClient()
      const feedPrice = Number(formData.feedPrice) || 0
      await client.mutation(api.dailyRecords.create, {
        cageId,
        date: formData.date,
        feedAmount,
        feedTypeId: formData.feedTypeId || undefined,
        feedPrice,
        feedCost: feedAmount * feedPrice,
        mortality: Number(formData.mortality) || 0,
        notes: formData.notes || undefined,
      })
      onSubmit?.(formData)
    } catch (err) {
      setError(err.message || 'Failed to save daily record')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-md mx-auto bg-surface border border-foam-deep p-6 rounded-lg shadow-sm">
      <h2 className="text-xl font-semibold text-chart-ink mb-4">Daily entry</h2>
      {error && (
        <div className="mb-4 text-sm text-signal border border-signal/20 bg-signal/10 rounded p-2">
          {error}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">Date</label>
          <input
            type="date"
            value={formData.date}
            onChange={(e) => setFormData({ ...formData, date: e.target.value })}
            className="w-full border border-input-border rounded px-3 py-2"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Feed type</label>
          <select
            value={formData.feedTypeId}
            onChange={(e) => {
              const ft = feedTypes.find((t) => (t.id || t._id) === e.target.value)
              setFormData({
                ...formData,
                feedTypeId: e.target.value,
                feedPrice: ft?.price_per_kg ?? ft?.pricePerKg ?? 0,
              })
            }}
            className="w-full border border-input-border rounded px-3 py-2"
          >
            <option value="">Select feed type</option>
            {feedTypes.map((t) => (
              <option key={t.id || t._id} value={t.id || t._id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Feed amount (kg)</label>
          <input
            type="number"
            step="0.1"
            value={formData.feedAmount}
            onChange={(e) => setFormData({ ...formData, feedAmount: e.target.value })}
            className="w-full border border-input-border rounded px-3 py-2 font-data"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Mortality</label>
          <input
            type="number"
            value={formData.mortality}
            onChange={(e) => setFormData({ ...formData, mortality: e.target.value })}
            className="w-full border border-input-border rounded px-3 py-2 font-data"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">Notes</label>
          <textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            className="w-full border border-input-border rounded px-3 py-2"
            rows="3"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving}
            className="bg-lagoon-800 text-white px-4 py-2 rounded hover:bg-lagoon-950 disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} className="bg-foam-deep text-chart-ink px-4 py-2 rounded">
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
