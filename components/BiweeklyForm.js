import React, { useState, useEffect } from 'react'
import { getConvexHttpClient, api } from '../lib/convexBridge'
import { cageService } from '../lib/cageService'

/** Lightweight biweekly ABW entry used from the dashboard modal. */
const BiweeklyForm = ({ cageId, onSuccess }) => {
  const [cage, setCage] = useState(null)
  const [abwHistory, setAbwHistory] = useState([])
  const [formData, setFormData] = useState({
    date: new Date().toISOString().split('T')[0],
    averageBodyWeight: '',
    totalFishCount: '',
    notes: '',
  })
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!cageId) return
    ;(async () => {
      const { data } = await cageService.getCageById(cageId)
      setCage(data)
      try {
        const client = getConvexHttpClient()
        const rows = await client.query(api.biweeklyRecords.list, { cageId })
        setAbwHistory(
          (rows || []).sort((a, b) => String(b.date).localeCompare(String(a.date))),
        )
      } catch {
        setAbwHistory([])
      }
    })()
  }, [cageId])

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
      const abw = Number(formData.averageBodyWeight)
      const fishCount = Number(
        formData.totalFishCount || cage?.current_count || cage?.currentCount || 0,
      )
      if (!abw || !fishCount) {
        throw new Error('ABW and fish count are required')
      }
      const client = getConvexHttpClient()
      await client.mutation(api.biweeklyRecords.create, {
        cageId,
        date: formData.date,
        batchCode: `${cage?.name || 'cage'}-${formData.date}-${Date.now()}`,
        averageBodyWeight: abw,
        totalFishCount: fishCount,
        totalWeight: (abw * fishCount) / 1000,
      })
      setMessage('ABW record saved')
      setFormData((prev) => ({
        ...prev,
        averageBodyWeight: '',
        totalFishCount: '',
        notes: '',
      }))
      const rows = await client.query(api.biweeklyRecords.list, { cageId })
      setAbwHistory(
        (rows || []).sort((a, b) => String(b.date).localeCompare(String(a.date))),
      )
      onSuccess?.()
    } catch (err) {
      setError(err.message || 'Save failed')
    } finally {
      setLoading(false)
    }
  }

  if (!cageId) {
    return (
      <div className="page-card p-8">
        <p className="text-center text-muted">Please select a cage first</p>
      </div>
    )
  }

  if (!cage) {
    return (
      <div className="page-card p-8">
        <p className="text-center text-muted">Loading cage…</p>
      </div>
    )
  }

  return (
    <div className="page-card overflow-hidden">
      <div className="px-6 py-4 border-b border-foam-deep">
        <h2 className="font-medium text-chart-ink">
          Biweekly Average Body Weight — {cage.name}
        </h2>
      </div>
      <div className="p-6">
        {message && (
          <div className="mb-4 text-sm text-kelp bg-kelp/10 border border-kelp/20 rounded p-2">
            {message}
          </div>
        )}
        {error && (
          <div className="mb-4 text-sm text-signal bg-signal/10 border border-signal/20 rounded p-2">
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-1">Date</label>
            <input
              type="date"
              name="date"
              value={formData.date}
              onChange={handleChange}
              className="w-full border border-input-border rounded px-3 py-2"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">ABW (g)</label>
            <input
              type="number"
              step="0.1"
              name="averageBodyWeight"
              value={formData.averageBodyWeight}
              onChange={handleChange}
              className="w-full border border-input-border rounded px-3 py-2 font-data"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-semibold mb-1">Fish count</label>
            <input
              type="number"
              name="totalFishCount"
              value={formData.totalFishCount}
              onChange={handleChange}
              placeholder={String(cage.current_count || cage.currentCount || '')}
              className="w-full border border-input-border rounded px-3 py-2 font-data"
            />
          </div>
          <button type="submit" disabled={loading} className="btn-primary">
            {loading ? 'Saving…' : 'Save ABW'}
          </button>
        </form>

        {abwHistory.length > 0 && (
          <div className="mt-6">
            <h3 className="text-sm font-semibold text-muted mb-2">Recent samples</h3>
            <ul className="text-sm space-y-1">
              {abwHistory.slice(0, 5).map((r) => (
                <li key={r.id || r._id} className="flex justify-between font-data">
                  <span>{r.date}</span>
                  <span>{r.average_body_weight ?? r.averageBodyWeight} g</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

export default BiweeklyForm
