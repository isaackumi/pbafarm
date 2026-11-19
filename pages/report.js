import { useState } from 'react'
import { useConvex, useQuery } from 'convex/react'
import { BarChart, Download, Printer } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import {
  PageHeader,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Select,
  StatCard,
  LoadingState,
} from '../components/ui'
import { api } from '../convex/_generated/api'
import { useLocation } from '../contexts/LocationContext'
import { errorMessage } from '../lib/errorMessage'
import { useMoney } from '../lib/money'
import { localToday } from '../lib/format'

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
  const money = useMoney()
  const [loading, setLoading] = useState(false)
  const [reportType, setReportType] = useState('production')
  const [dateRange, setDateRange] = useState({
    startDate: new Date(new Date().setDate(new Date().getDate() - 30))
      .toISOString()
      .split('T')[0],
    endDate: localToday(),
  })
  const [selectedCages, setSelectedCages] = useState([])
  const [reportData, setReportData] = useState(null)
  const [error, setError] = useState(null)

  const client = useConvex()
  const { locationArgs } = useLocation()
  const cagesResult = useQuery(api.cages.list, locationArgs)
  const cages = cagesResult || []

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
      setError(errorMessage(err, String(err)))
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
    link.download = `${reportType}-report-${localToday()}.json`
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
          <Card padding={false} className="overflow-hidden">
            <div className="px-5 py-4 border-b border-foam-deep">
              <h2 className="font-medium text-chart-ink">Report options</h2>
            </div>
            <div className="p-5 space-y-5">
              <Field label="Report type" htmlFor="report-type">
                <Select
                  id="report-type"
                  value={reportType}
                  onChange={(e) => setReportType(e.target.value)}
                >
                  <option value="production">Production summary</option>
                  <option value="feed">Feed usage</option>
                  <option value="growth">Growth performance</option>
                  <option value="mortality">Mortality analysis</option>
                  <option value="financial">Financial summary</option>
                </Select>
              </Field>

              <fieldset className="space-y-1.5">
                <legend className="block text-sm font-semibold text-chart-ink mb-1.5">
                  Date range
                </legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-3">
                  <Field label="From" htmlFor="report-start">
                    <Input
                      id="report-start"
                      type="date"
                      name="startDate"
                      value={dateRange.startDate}
                      onChange={handleDateRangeChange}
                    />
                  </Field>
                  <Field label="To" htmlFor="report-end">
                    <Input
                      id="report-end"
                      type="date"
                      name="endDate"
                      value={dateRange.endDate}
                      onChange={handleDateRangeChange}
                    />
                  </Field>
                </div>
              </fieldset>

              <fieldset>
                <legend className="block text-sm font-semibold text-chart-ink mb-1.5">
                  Cages
                </legend>
                <div className="bg-foam border border-foam-deep p-2 rounded-lg max-h-60 overflow-y-auto">
                  <label
                    htmlFor="select-all"
                    className="flex items-center gap-3 min-h-10 px-1 text-sm font-medium text-chart-ink cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      id="select-all"
                      checked={
                        selectedCages.length === cages.length &&
                        cages.length > 0
                      }
                      onChange={handleSelectAllCages}
                      className="h-4 w-4 rounded accent-lake"
                    />
                    Select all
                  </label>
                  <div className="border-t border-foam-deep pt-1">
                    {cages.map((cage) => {
                      const id = cageKey(cage)
                      return (
                        <label
                          key={id}
                          htmlFor={`cage-${id}`}
                          className="flex items-center gap-3 min-h-10 px-1 text-sm text-chart-ink cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            id={`cage-${id}`}
                            checked={selectedCages.includes(id)}
                            onChange={() => handleCageToggle(id)}
                            className="h-4 w-4 rounded accent-lake"
                          />
                          <span>
                            {cage.name}
                            {cage.status !== 'active' && (
                              <span className="ml-2 text-xs text-muted">
                                ({cage.status})
                              </span>
                            )}
                          </span>
                        </label>
                      )
                    })}
                    {cagesResult === undefined && <LoadingState label="Loading cages..." />}
                    {cagesResult !== undefined && cages.length === 0 && (
                      <p className="px-1 py-2 text-sm text-muted">No cages found</p>
                    )}
                  </div>
                </div>
              </fieldset>

              <Button
                onClick={generateReport}
                disabled={loading}
                className="w-full"
              >
                {loading ? (
                  'Generating…'
                ) : (
                  <>
                    <BarChart className="w-4 h-4" />
                    Generate report
                  </>
                )}
              </Button>

              {error && (
                <div
                  role="alert"
                  className="bg-signal/10 text-signal border border-signal/20 p-3 rounded-lg text-sm"
                >
                  {error}
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="lg:col-span-3 min-w-0">
          <Card padding={false} className="overflow-hidden">
            <div className="px-5 py-4 border-b border-foam-deep flex flex-wrap gap-3 justify-between items-center">
              <h2 className="font-medium text-chart-ink">Report preview</h2>
              {reportData && (
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={downloadReport}>
                    <Download className="h-4 w-4" />
                    Download
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => window.print()}
                  >
                    <Printer className="h-4 w-4" />
                    Print
                  </Button>
                </div>
              )}
            </div>

            <div className="p-5 sm:p-6">
              {!reportData ? (
                <div className="min-h-[18rem] flex items-center justify-center">
                  <EmptyState
                    title="No report yet"
                    description="Pick a report type, date range and cages, then generate a report to see it here."
                  />
                </div>
              ) : (
                <div id="report-content" className="space-y-6">
                  <div className="text-center pb-6 border-b border-foam-deep">
                    <h1 className="text-2xl font-medium text-chart-ink font-display">
                      {reportType === 'production' &&
                        'Production summary report'}
                      {reportType === 'feed' && 'Feed usage report'}
                      {reportType === 'growth' && 'Growth performance report'}
                      {reportType === 'mortality' &&
                        'Mortality analysis report'}
                      {reportType === 'financial' &&
                        'Financial summary report'}
                    </h1>
                    <p className="text-sm text-muted mt-1 tabular-nums">
                      {new Date(dateRange.startDate).toLocaleDateString()} to{' '}
                      {new Date(dateRange.endDate).toLocaleDateString()}
                    </p>
                    <p className="text-sm text-muted mt-1 tabular-nums">
                      Generated:{' '}
                      {new Date(reportData.generatedAt).toLocaleString()}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <StatCard
                      label="Total feed used"
                      value={Number(summary.total_feed_kg || 0).toFixed(1)}
                      unit="kg"
                    />
                    <StatCard
                      label="Total mortality"
                      value={summary.total_mortality || 0}
                      unit="fish"
                    />
                    <StatCard
                      label="Feed cost"
                      value={money(summary.total_feed_cost || 0)}
                    />
                    <StatCard
                      label="Avg FCR"
                      value={
                        summary.avg_fcr != null
                          ? Number(summary.avg_fcr).toFixed(2)
                          : '—'
                      }
                    />
                    <StatCard
                      label="Growth"
                      value={
                        summary.avg_growth_g_day != null
                          ? Number(summary.avg_growth_g_day).toFixed(2)
                          : '—'
                      }
                      unit="g/day"
                    />
                    <StatCard
                      label="Harvest weight"
                      value={Number(summary.harvest_weight_kg || 0).toFixed(1)}
                      unit="kg"
                    />
                  </div>

                  {reportType === 'production' && (
                    <DataTable
                      title="By cage"
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
                          ? 'Daily feed rows'
                          : reportType === 'growth'
                            ? 'Growth samples'
                            : reportType === 'mortality'
                              ? 'Mortality events'
                              : 'Financial rows'
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
          </Card>
        </div>
      </div>
    </Layout>
  )
}

function DataTable({ title, columns, rows }) {
  return (
    <div>
      <h3 className="text-base font-medium text-chart-ink mb-3">{title}</h3>
      <div className="overflow-x-auto border border-foam-deep rounded-lg">
        <table className="min-w-full divide-y divide-foam-deep">
          <thead className="bg-foam">
            <tr>
              {columns.map((c) => (
                <th
                  key={c}
                  className="px-4 py-3 text-left text-xs font-medium text-muted"
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
                  className="px-4 py-6 text-sm text-muted text-center"
                >
                  No rows in this range
                </td>
              </tr>
            ) : (
              rows.map((row, i) => (
                <tr key={i} className="hover:bg-foam">
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className="px-4 py-3 whitespace-nowrap text-sm text-chart-ink font-data tabular-nums"
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
