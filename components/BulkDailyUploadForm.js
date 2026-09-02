import React, { useState } from 'react'
import { getConvexHttpClient, api } from '../lib/convexBridge'
import { cageService } from '../lib/cageService'
import { feedTypeService } from '../lib/feedTypeService'
import { Button, FormActions, FormSection, Field } from './ui'

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
        const feedPrice = Number(
          row.feed_price || feedType?.price_per_kg || feedType?.pricePerKg || 0,
        )
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
    <div>
      <FormSection
        title="Daily CSV"
        description="Header: cage_name, date, feed_amount, feed_type, feed_price, mortality, notes"
      >
        {error && (
          <div className="mb-4 text-sm text-signal border border-signal/20 bg-signal/10 rounded-xl p-3">
            {error}
          </div>
        )}
        {result && (
          <div className="mb-4 text-sm text-kelp border border-kelp/20 bg-kelp/10 rounded-xl p-3">
            Inserted {result.inserted} of {result.attempted} rows
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-5">
          <Field label="CSV file" htmlFor="daily-csv" required>
            <input
              id="daily-csv"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="block w-full text-sm text-chart-ink file:mr-4 file:rounded-xl file:border-0 file:bg-foam file:px-4 file:py-2.5 file:text-sm file:font-semibold file:text-chart-ink hover:file:bg-zinc-200/80"
            />
          </Field>
          <FormActions className="mt-4 pt-4">
            <Button type="submit" disabled={loading} size="lg">
              {loading ? 'Uploading…' : 'Upload CSV'}
            </Button>
            {onCancel && (
              <Button type="button" variant="secondary" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </FormActions>
        </form>
      </FormSection>
    </div>
  )
}
