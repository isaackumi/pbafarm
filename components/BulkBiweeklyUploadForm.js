import React, { useState } from 'react'
import { getConvexHttpClient, api } from '../lib/convexBridge'
import { cageService } from '../lib/cageService'
import { Button, FormActions, FormSection, Field } from './ui'

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
    <div>
      <FormSection
        title="Bi-weekly CSV"
        description="Header: cage_name, date, batch_code, average_body_weight, total_fish_count, total_weight"
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
          <Field label="CSV file" htmlFor="biweekly-csv" required>
            <input
              id="biweekly-csv"
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
          </FormActions>
        </form>
      </FormSection>
    </div>
  )
}
