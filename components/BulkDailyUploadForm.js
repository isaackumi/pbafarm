import React, { useState } from 'react'
import { getConvexHttpClient, api } from '../lib/convexBridge'
import { cageService } from '../lib/cageService'
import { feedTypeService } from '../lib/feedTypeService'

/**
 * CSV columns (header row):
 * cage_name,date,feed_amount,feed_type,feed_price,mortality,notes
 */
export default function BulkDailyUploadForm({ onSuccess, onCancel }) {
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const parseCsv = (text) => {
    const lines = text.trim().split(/\r?\n/)
    if (lines.length < 2) throw new Error('CSV needs a header and at least one row')
    const headers = lines[0].split(',').map((h) => h.trim().toLowerCase())
    return lines.slice(1).map((line) => {
      const cols = line.split(',').map((c) => c.trim())
      const row = {}
      headers.forEach((h, i) => {
        row[h] = cols[i]
      })
      return row
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!file) {
      setError('Please select a CSV file')
      return
    }
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const text = await file.text()
      const rows = parseCsv(text)
      const [{ data: cages }, { data: feedTypes }] = await Promise.all([
        cageService.getAllCages(),
        feedTypeService.getAllFeedTypes(),
      ])
      const byName = Object.fromEntries(
        (cages || []).map((c) => [c.name.toLowerCase(), c.id || c._id]),
      )
      const feedByName = Object.fromEntries(
        (feedTypes || []).map((t) => [t.name.toLowerCase(), t]),
      )

      const records = []
      for (const row of rows) {
        const cageId = byName[(row.cage_name || row.cage || '').toLowerCase()]
        if (!cageId) continue
        const feedType = feedByName[(row.feed_type || '').toLowerCase()]
        const feedAmount = Number(row.feed_amount || 0)
        if (feedAmount > 0 && !feedType) {
          throw new Error(
            `Unknown feed_type "${row.feed_type}" on ${row.date} — must match a feed type name`,
          )
        }
        const feedPrice = Number(row.feed_price || feedType?.price_per_kg || feedType?.pricePerKg || 0)
        records.push({
          cageId,
          date: row.date,
          feedAmount,
          feedTypeId: feedType ? feedType.id || feedType._id : undefined,
          feedType: row.feed_type || undefined,
          feedPrice,
          feedCost: feedAmount * feedPrice,
          mortality: Number(row.mortality || 0),
          notes: row.notes || undefined,
        })
      }

      if (!records.length) throw new Error('No valid rows found (check cage names)')

      const client = getConvexHttpClient()
      const ids = await client.mutation(api.dailyRecords.createMany, { records })
      setResult({ attempted: rows.length, inserted: ids.length })
      onSuccess?.()
    } catch (err) {
      setError(err.message || 'Bulk upload failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-md mx-auto bg-surface border border-foam-deep p-6 rounded-lg shadow-sm">
      <h2 className="text-xl font-semibold text-chart-ink mb-2">Bulk daily upload</h2>
      <p className="text-sm text-muted mb-4">
        CSV header: <span className="font-data">cage_name,date,feed_amount,feed_type,feed_price,mortality,notes</span>
      </p>
      {error && (
        <div className="mb-3 text-sm text-signal border border-signal/20 bg-signal/10 rounded p-2">{error}</div>
      )}
      {result && (
        <div className="mb-3 text-sm text-kelp border border-kelp/20 bg-foam rounded p-2">
          Inserted {result.inserted} of {result.attempted} rows
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="w-full border border-input-border rounded px-3 py-2"
        />
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={loading}
            className="bg-lagoon-800 text-white px-4 py-2 rounded hover:bg-lagoon-950 disabled:opacity-60"
          >
            {loading ? 'Uploading…' : 'Upload'}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} className="bg-foam-deep px-4 py-2 rounded">
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
