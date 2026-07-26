import React, { useState } from 'react'
import { getConvexHttpClient, api } from '../lib/convexBridge'
import { cageService } from '../lib/cageService'

/**
 * CSV columns (header row):
 * cage_name,date,batch_code,average_body_weight,total_fish_count,total_weight
 */
export default function BulkBiweeklyUploadForm({ onSuccess }) {
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
      const { data: cages } = await cageService.getAllCages()
      const byName = Object.fromEntries(
        (cages || []).map((c) => [c.name.toLowerCase(), c.id || c._id]),
      )

      const records = []
      for (const row of rows) {
        const cageId = byName[(row.cage_name || row.cage || '').toLowerCase()]
        if (!cageId) continue
        const abw = Number(row.average_body_weight || row.abw || 0)
        const fishCount = Number(row.total_fish_count || row.fish_count || 0)
        const totalWeight = Number(
          row.total_weight || (abw * fishCount) / 1000 || 0,
        )
        const batchCode =
          row.batch_code ||
          row.batch ||
          `${row.cage_name || 'cage'}-${row.date}`
        if (!row.date || !abw) continue
        records.push({
          cageId,
          date: row.date,
          batchCode,
          averageBodyWeight: abw,
          totalFishCount: fishCount,
          totalWeight,
        })
      }

      if (!records.length) {
        throw new Error('No valid rows found (check cage names and columns)')
      }

      const client = getConvexHttpClient()
      const ids = await client.mutation(api.biweeklyRecords.createMany, {
        records,
      })
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
      <h2 className="text-xl font-semibold text-chart-ink mb-2">
        Bulk biweekly upload
      </h2>
      <p className="text-sm text-muted mb-4">
        CSV header:{' '}
        <span className="font-data">
          cage_name,date,batch_code,average_body_weight,total_fish_count,total_weight
        </span>
      </p>
      {error && (
        <div className="mb-3 text-sm text-signal border border-signal/20 bg-signal/10 rounded p-2">
          {error}
        </div>
      )}
      {result && (
        <div className="mb-3 text-sm text-kelp border border-kelp/20 bg-kelp/10 rounded p-2">
          Inserted {result.inserted} of {result.attempted} rows
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          className="w-full text-sm"
        />
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? 'Uploading…' : 'Upload CSV'}
        </button>
      </form>
    </div>
  )
}
