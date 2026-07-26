import React, { useState } from 'react'
import Layout from '../components/Layout'
import ProtectedRoute from '../components/ProtectedRoute'
import { getConvexHttpClient, api } from '../lib/convexBridge'
import * as XLSX from 'xlsx'

function downloadWorkbook(sheets, filename) {
  const wb = XLSX.utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) {
    const data = Array.isArray(rows) ? rows : [rows]
    const ws = XLSX.utils.json_to_sheet(data.length ? data : [{ note: 'No rows' }])
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31))
  }
  XLSX.writeFile(wb, filename)
}

function ExportPageInner() {
  const [exportType, setExportType] = useState('daily_records')
  const [format, setFormat] = useState('xlsx')
  const [dateRange, setDateRange] = useState({
    startDate: new Date(new Date().setDate(new Date().getDate() - 30))
      .toISOString()
      .split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleExport = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const client = getConvexHttpClient()
      const bundle = await client.query(api.reports.exportBundle, {
        dateFrom: dateRange.startDate,
        dateTo: dateRange.endDate,
      })

      let sheets = {}
      let payload = bundle

      if (exportType === 'daily_records') {
        payload = bundle.daily_records || []
        sheets = { daily_records: payload }
      } else if (exportType === 'biweekly_records') {
        payload = bundle.biweekly_records || []
        sheets = { biweekly_records: payload }
      } else if (exportType === 'harvest_records') {
        payload = bundle.harvest_records || []
        sheets = { harvest_records: payload }
      } else if (exportType === 'cages') {
        payload = await client.query(api.cages.list, {})
        sheets = { cages: payload || [] }
      } else if (exportType === 'stocking_history') {
        payload = await client.query(api.stocking.listStockingHistory, {})
        sheets = { stocking_history: payload || [] }
      } else {
        sheets = {
          daily_records: bundle.daily_records || [],
          biweekly_records: bundle.biweekly_records || [],
          harvest_records: bundle.harvest_records || [],
          summary: [bundle.totals || bundle.summary || {}],
        }
        payload = bundle
      }

      const base = `${exportType}-${dateRange.startDate}-to-${dateRange.endDate}`

      if (format === 'json') {
        const blob = new Blob([JSON.stringify(payload, null, 2)], {
          type: 'application/json',
        })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `${base}.json`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
      } else {
        downloadWorkbook(sheets, `${base}.xlsx`)
      }
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Layout title="Export">
      <div className="max-w-2xl mx-auto">
        <h1 className="page-title mb-6">Export Data</h1>

        <div className="page-card p-6">
          <form onSubmit={handleExport} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-2">Export type</label>
              <select
                value={exportType}
                onChange={(e) => setExportType(e.target.value)}
                className="w-full border border-input-border rounded px-3 py-2 font-medium"
                required
              >
                <option value="daily_records">Daily Records</option>
                <option value="biweekly_records">Biweekly Records</option>
                <option value="harvest_records">Harvest Records</option>
                <option value="stocking_history">Stocking History</option>
                <option value="cages">Cage Information</option>
                <option value="all">Full Bundle</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-2">Format</label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className="w-full border border-input-border rounded px-3 py-2 font-medium"
              >
                <option value="xlsx">Excel (.xlsx)</option>
                <option value="json">JSON</option>
              </select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold mb-2">From</label>
                <input
                  type="date"
                  value={dateRange.startDate}
                  onChange={(e) =>
                    setDateRange({ ...dateRange, startDate: e.target.value })
                  }
                  className="w-full border border-input-border rounded px-3 py-2"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2">To</label>
                <input
                  type="date"
                  value={dateRange.endDate}
                  onChange={(e) =>
                    setDateRange({ ...dateRange, endDate: e.target.value })
                  }
                  className="w-full border border-input-border rounded px-3 py-2"
                  required
                />
              </div>
            </div>

            {error && (
              <div className="text-sm font-medium text-signal bg-signal/10 p-3 rounded">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading
                ? 'Exporting…'
                : format === 'xlsx'
                  ? 'Download Excel'
                  : 'Download JSON'}
            </button>
          </form>
        </div>
      </div>
    </Layout>
  )
}

export default function ExportPage() {
  return (
    <ProtectedRoute>
      <ExportPageInner />
    </ProtectedRoute>
  )
}
