import React, { useState } from 'react'
import Layout from '../components/Layout'
import ProtectedRoute from '../components/ProtectedRoute'
import {
  PageHeader,
  Button,
  FormPage,
  FormCard,
  FormActions,
  FormSection,
  Field,
  Select,
  Input,
} from '../components/ui'
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
      <FormPage>
        <PageHeader
          showTitle={false}
          breadcrumbs={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Reports', href: '/report' },
            { label: 'Export' },
          ]}
          description="Download farm records as Excel for offline analysis or sharing."
          related={[
            { label: 'Reports', href: '/report' },
            { label: 'Audit logs', href: '/audit-logs' },
          ]}
        />

        <FormCard
          title="Export options"
          subtitle="Choose what to download and the date window."
        >
          <form onSubmit={handleExport} className="space-y-8">
            <FormSection title="Dataset">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Field label="Export type" htmlFor="exportType" required>
                  <Select
                    id="exportType"
                    value={exportType}
                    onChange={(e) => setExportType(e.target.value)}
                    required
                  >
                    <option value="daily_records">Daily Records</option>
                    <option value="biweekly_records">Biweekly Records</option>
                    <option value="harvest_records">Harvest Records</option>
                    <option value="stocking_history">Stocking History</option>
                    <option value="cages">Cage Information</option>
                    <option value="all">Full Bundle</option>
                  </Select>
                </Field>
                <Field label="Format" htmlFor="format">
                  <Select
                    id="format"
                    value={format}
                    onChange={(e) => setFormat(e.target.value)}
                  >
                    <option value="xlsx">Excel (.xlsx)</option>
                    <option value="csv">CSV</option>
                    <option value="json">JSON</option>
                  </Select>
                </Field>
              </div>
            </FormSection>

            <FormSection title="Date range">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <Field label="From" htmlFor="startDate" required>
                  <Input
                    id="startDate"
                    type="date"
                    value={dateRange.startDate}
                    onChange={(e) =>
                      setDateRange({ ...dateRange, startDate: e.target.value })
                    }
                    required
                  />
                </Field>
                <Field label="To" htmlFor="endDate" required>
                  <Input
                    id="endDate"
                    type="date"
                    value={dateRange.endDate}
                    onChange={(e) =>
                      setDateRange({ ...dateRange, endDate: e.target.value })
                    }
                    required
                  />
                </Field>
              </div>
            </FormSection>

            {error && (
              <div className="text-sm font-medium text-signal bg-signal/10 border border-signal/20 p-3 rounded-xl">
                {error}
              </div>
            )}

            <FormActions>
              <Button type="submit" disabled={loading} size="lg">
                {loading
                  ? 'Exporting…'
                  : format === 'xlsx'
                    ? 'Download Excel'
                    : format === 'csv'
                      ? 'Download CSV'
                      : 'Download JSON'}
              </Button>
            </FormActions>
          </form>
        </FormCard>
      </FormPage>
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
