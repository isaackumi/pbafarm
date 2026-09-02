import { useState, useEffect } from 'react'
import { FileText, BarChart, Download, Printer } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { PageHeader, Button } from '../components/ui'
import { getConvexHttpClient, api } from '../lib/convexBridge'
import { cageService } from '../lib/cageService'

export default function ReportsPage() {
  return (
    <ProtectedRoute>
      <Reports />
    </ProtectedRoute>
  )
}

function cageKey(cage) {
  return cage.id || cage._id
}

function Reports() {
  const [loading, setLoading] = useState(false)
  const [reportType, setReportType] = useState('production')
  const [dateRange, setDateRange] = useState({
    startDate: new Date(new Date().setDate(new Date().getDate() - 30))
      .toISOString()
      .split('T')[0],
    endDate: new Date().toISOString().split('T')[0],
  })
  const [cages, setCages] = useState([])
  const [selectedCages, setSelectedCages] = useState([])
  const [reportData, setReportData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function fetchCages() {
      try {
        const { data, error: err } = await cageService.getAllCages()
        if (err) throw err
        setCages(data || [])
      } catch (err) {
        console.error('Error fetching cages:', err.message)
        setError(err.message)
      }
    }
    fetchCages()
  }, [])

  const handleCageToggle = (id) => {
    setSelectedCages((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const handleSelectAllCages = () => {
    if (selectedCages.length === cages.length) {
      setSelectedCages([])
    } else {
      setSelectedCages(cages.map(cageKey))
    }
  }

  const handleDateRangeChange = (e) => {
    setDateRange({ ...dateRange, [e.target.name]: e.target.value })
  }

  const generateReport = async () => {
    setLoading(true)
    setError(null)
    setReportData(null)

    try {
      if (selectedCages.length === 0) {
        throw new Error('Please select at least one cage')
      }
      if (!dateRange.startDate || !dateRange.endDate) {
        throw new Error('Please select a date range')
      }

      const client = getConvexHttpClient()
      const result = await client.query(api.reports.productionReport, {
        reportType,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        cageIds: selectedCages,
      })

      setReportData({
        reportType,
        dateRange,
        selectedCages,
        generatedAt: new Date().toISOString(),
        data: result,
      })
    } catch (err) {
      console.error('Error generating report:', err)
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  const downloadReport = () => {
    if (!reportData) return
    const jsonString = JSON.stringify(reportData, null, 2)
    const blob = new Blob([jsonString], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${reportType}-report-${new Date().toISOString().split('T')[0]}.json`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const summary = reportData?.data?.summary || {}
  const byCage = reportData?.data?.by_cage || []
  const rowsForType = () => {
    const d = reportData?.data
    if (!d) return []
    if (reportType === 'feed') return d.daily_rows || []
    if (reportType === 'growth') return d.growth_rows || []
    if (reportType === 'mortality') return d.mortality_rows || []
    if (reportType === 'financial') return d.financial_rows || []
    return d.by_cage || []
  }

  return (
    <Layout title="Reports">
      <PageHeader
        showTitle={false}
        breadcrumbs={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Reports' },
        ]}
        description="Generate production, feed, growth, mortality, and financial reports."
        related={[
          { label: 'Export', href: '/export' },
          { label: 'Inventory analytics', href: '/inventory/analytics' },
          { label: 'Cage analytics', href: '/cages/analytics' },
        ]}
        actions={
          <Button href="/dashboard" variant="secondary" size="sm">
            Back
          </Button>
        }
      />

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1">
            <div className="bg-surface border border-foam-deep rounded-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-foam-deep">
                <h2 className="font-semibold text-chart-ink">Report Options</h2>
              </div>
              <div className="p-6 space-y-6">
                <div>
                  <label className="block text-sm font-semibold text-chart-ink mb-1">
                    Report Type
                  </label>
                  <select
                    value={reportType}
                    onChange={(e) => setReportType(e.target.value)}
                    className="block w-full px-3 py-2 border border-input-border rounded-md text-sm font-medium"
                  >
                    <option value="production">Production Summary</option>
                    <option value="feed">Feed Usage</option>
                    <option value="growth">Growth Performance</option>
                    <option value="mortality">Mortality Analysis</option>
                    <option value="financial">Financial Summary</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-chart-ink mb-1">
                    Date Range
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-muted mb-1 font-medium">
                        From
                      </label>
                      <input
                        type="date"
                        name="startDate"
                        value={dateRange.startDate}
                        onChange={handleDateRangeChange}
                        className="block w-full px-3 py-2 border border-input-border rounded-md text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-muted mb-1 font-medium">
                        To
                      </label>
                      <input
                        type="date"
                        name="endDate"
                        value={dateRange.endDate}
                        onChange={handleDateRangeChange}
                        className="block w-full px-3 py-2 border border-input-border rounded-md text-sm"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-chart-ink mb-1">
                    Select Cages
                  </label>
                  <div className="mt-1 bg-foam p-3 rounded-md max-h-60 overflow-y-auto">
                    <div className="flex items-center mb-2">
                      <input
                        type="checkbox"
                        id="select-all"
                        checked={
                          selectedCages.length === cages.length &&
                          cages.length > 0
                        }
                        onChange={handleSelectAllCages}
                        className="h-4 w-4 text-lagoon-800 border-input-border rounded"
                      />
                      <label
                        htmlFor="select-all"
                        className="ml-2 text-sm font-medium text-chart-ink"
                      >
                        Select All
                      </label>
                    </div>
                    <div className="space-y-2">
                      {cages.map((cage) => {
                        const id = cageKey(cage)
                        return (
                          <div key={id} className="flex items-center">
                            <input
                              type="checkbox"
                              id={`cage-${id}`}
                              checked={selectedCages.includes(id)}
                              onChange={() => handleCageToggle(id)}
                              className="h-4 w-4 text-lagoon-800 border-input-border rounded"
                            />
                            <label
                              htmlFor={`cage-${id}`}
                              className="ml-2 text-sm font-medium text-chart-ink"
                            >
                              {cage.name}
                              {cage.status !== 'active' && (
                                <span className="ml-2 text-xs text-muted">
                                  ({cage.status})
                                </span>
                              )}
                            </label>
                          </div>
                        )
                      })}
                      {cages.length === 0 && (
                        <p className="text-sm text-muted">No cages found</p>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  onClick={generateReport}
                  disabled={loading}
                  className={`w-full flex justify-center items-center py-2.5 px-4 rounded-md text-sm font-semibold text-white ${
                    loading
                      ? 'bg-lagoon-700/60'
                      : 'bg-lagoon-800 hover:bg-lagoon-950'
                  }`}
                >
                  {loading ? (
                    'Generating…'
                  ) : (
                    <>
                      <BarChart className="w-4 h-4 mr-2" />
                      Generate Report
                    </>
                  )}
                </button>

                {error && (
                  <div className="bg-signal/10 text-signal p-3 rounded-md text-sm font-medium">
                    {error}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="lg:col-span-3">
            <div className="bg-surface border border-foam-deep rounded-lg overflow-hidden">
              <div className="px-6 py-4 border-b border-foam-deep flex justify-between items-center">
                <h2 className="font-semibold text-chart-ink">Report Preview</h2>
                {reportData && (
                  <div className="flex space-x-2">
                    <button
                      onClick={downloadReport}
                      className="inline-flex items-center px-3 py-1 border border-input-border text-sm font-semibold rounded-md text-chart-ink bg-surface hover:bg-foam"
                    >
                      <Download className="h-4 w-4 mr-1" />
                      Download
                    </button>
                    <button
                      onClick={() => window.print()}
                      className="inline-flex items-center px-3 py-1 border border-input-border text-sm font-semibold rounded-md text-chart-ink bg-surface hover:bg-foam"
                    >
                      <Printer className="h-4 w-4 mr-1" />
                      Print
                    </button>
                  </div>
                )}
              </div>

              <div className="p-6">
                {!reportData ? (
                  <div className="h-96 flex flex-col items-center justify-center text-muted">
                    <FileText className="h-12 w-12 mb-4" />
                    <p className="text-lg font-semibold">
                      Generate a report to see a preview
                    </p>
                    <p className="text-sm mt-2 font-medium">
                      Select report type, date range, and cages, then click
                      Generate Report
                    </p>
                  </div>
                ) : (
                  <div id="report-content" className="space-y-6">
                    <div className="text-center pb-6 border-b border-foam-deep">
                      <h1 className="text-2xl font-bold text-chart-ink font-display">
                        {reportType === 'production' &&
                          'Production Summary Report'}
                        {reportType === 'feed' && 'Feed Usage Report'}
                        {reportType === 'growth' && 'Growth Performance Report'}
                        {reportType === 'mortality' &&
                          'Mortality Analysis Report'}
                        {reportType === 'financial' &&
                          'Financial Summary Report'}
                      </h1>
                      <p className="text-sm text-muted mt-1 font-medium">
                        {new Date(dateRange.startDate).toLocaleDateString()} to{' '}
                        {new Date(dateRange.endDate).toLocaleDateString()}
                      </p>
                      <p className="text-sm text-muted mt-1 font-medium">
                        Generated:{' '}
                        {new Date(reportData.generatedAt).toLocaleString()}
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <Stat
                        label="Total Feed Used"
                        value={`${Number(summary.total_feed_kg || 0).toFixed(1)} kg`}
                      />
                      <Stat
                        label="Total Mortality"
                        value={`${summary.total_mortality || 0} fish`}
                      />
                      <Stat
                        label="Feed Cost"
                        value={`$${Number(summary.total_feed_cost || 0).toFixed(2)}`}
                      />
                      <Stat
                        label="Avg FCR"
                        value={
                          summary.avg_fcr != null
                            ? Number(summary.avg_fcr).toFixed(2)
                            : '—'
                        }
                      />
                      <Stat
                        label="Growth (g/day)"
                        value={
                          summary.avg_growth_g_day != null
                            ? Number(summary.avg_growth_g_day).toFixed(2)
                            : '—'
                        }
                      />
                      <Stat
                        label="Harvest Weight"
                        value={`${Number(summary.harvest_weight_kg || 0).toFixed(1)} kg`}
                      />
                    </div>

                    {reportType === 'production' && (
                      <DataTable
                        title="By Cage"
                        columns={[
                          'Cage',
                          'Status',
                          'Count',
                          'Feed kg',
                          'Mortality',
                          'Latest ABW',
                          'Harvest kg',
                        ]}
                        rows={byCage.map((r) => [
                          r.cage_name,
                          r.status,
                          r.current_count,
                          Number(r.feed_kg).toFixed(1),
                          r.mortality,
                          r.latest_abw != null
                            ? Number(r.latest_abw).toFixed(1)
                            : '—',
                          Number(r.harvest_weight_kg).toFixed(1),
                        ])}
                      />
                    )}

                    {reportType !== 'production' && (
                      <DataTable
                        title={
                          reportType === 'feed'
                            ? 'Daily Feed Rows'
                            : reportType === 'growth'
                              ? 'Growth Samples'
                              : reportType === 'mortality'
                                ? 'Mortality Events'
                                : 'Financial Rows'
                        }
                        columns={
                          reportType === 'feed'
                            ? ['Date', 'Cage', 'Feed kg', 'Cost', 'Mortality']
                            : reportType === 'growth'
                              ? [
                                  'Date',
                                  'Cage',
                                  'Batch',
                                  'ABW',
                                  'Fish',
                                  'Weight',
                                ]
                              : reportType === 'mortality'
                                ? ['Date', 'Cage', 'Mortality', 'Notes']
                                : [
                                    'Date',
                                    'Cage',
                                    'Feed kg',
                                    'Unit price',
                                    'Cost',
                                  ]
                        }
                        rows={rowsForType().map((r) => {
                          if (reportType === 'feed')
                            return [
                              r.date,
                              r.cage,
                              r.feed_kg,
                              r.feed_cost,
                              r.mortality,
                            ]
                          if (reportType === 'growth')
                            return [
                              r.date,
                              r.cage,
                              r.batch_code,
                              r.abw,
                              r.fish_count,
                              r.total_weight,
                            ]
                          if (reportType === 'mortality')
                            return [r.date, r.cage, r.mortality, r.notes]
                          return [
                            r.date,
                            r.cage,
                            r.feed_kg,
                            r.unit_price,
                            r.feed_cost,
                          ]
                        })}
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
    </Layout>
  )
}

function Stat({ label, value }) {
  return (
    <div className="bg-foam border border-foam-deep p-4 rounded-lg">
      <p className="text-sm font-semibold text-muted">{label}</p>
      <p className="text-2xl font-bold text-lagoon-800 mt-1 font-data">
        {value}
      </p>
    </div>
  )
}

function DataTable({ title, columns, rows }) {
  return (
    <div>
      <h3 className="text-lg font-bold text-chart-ink mb-3">{title}</h3>
      <div className="overflow-x-auto border border-foam-deep rounded-lg">
        <table className="min-w-full divide-y divide-foam-deep">
          <thead className="bg-foam">
            <tr>
              {columns.map((c) => (
                <th
                  key={c}
                  className="px-4 py-3 text-left text-xs font-bold text-muted uppercase tracking-wider"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-surface divide-y divide-foam-deep">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-6 text-sm text-muted font-medium text-center"
                >
                  No rows in this range
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className="px-4 py-3 whitespace-nowrap text-sm font-medium text-chart-ink font-data"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
