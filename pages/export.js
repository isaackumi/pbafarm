import React, { useState } from 'react'
import Layout from '../components/Layout'
import { getConvexHttpClient, api } from '../lib/convexBridge'

const ExportPage = () => {
  const [exportType, setExportType] = useState('daily_records')
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

      let payload = bundle
      if (exportType === 'daily_records') payload = bundle.daily_records || []
      else if (exportType === 'biweekly_records')
        payload = bundle.biweekly_records || []
      else if (exportType === 'harvest_records')
        payload = bundle.harvest_records || []
      else if (exportType === 'cages') {
        payload = await client.query(api.cages.list, {})
      } else if (exportType === 'stocking_history') {
        payload = await client.query(api.stocking.listStockingHistory, {})
      }

      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${exportType}-${dateRange.startDate}-to-${dateRange.endDate}.json`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Layout>
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-6 font-display">Export Data</h1>

        <div className="bg-surface border border-foam-deep p-6 rounded-lg">
          <form onSubmit={handleExport} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-2">
                Export Type
              </label>
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

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-lagoon-800 hover:bg-lagoon-950 text-white font-bold py-2.5 rounded-md disabled:opacity-60"
            >
              {loading ? 'Exporting…' : 'Download JSON'}
            </button>
          </form>
        </div>
      </div>
    </Layout>
  )
}

export default ExportPage
