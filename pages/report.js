import { useState } from 'react'
import { useConvex, useQuery } from 'convex/react'
import { BarChart, Download, Printer } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import Layout from '../components/Layout'
import { Field, GradientButton, Input, KpiStrip, LoadingState, Select, Table } from '../components/ui'
import NavTabs from '../components/ui/NavTabs'
import { Panel } from '../components/ui/Panel'
import { api } from '../convex/_generated/api'
import { useLocation } from '../contexts/LocationContext'
import { errorMessage } from '../lib/errorMessage'
import { useMoney } from '../lib/money'
import { localToday } from '../lib/format'
import { useLocale, useT } from '../lib/i18n/context'
import { reportTabs } from '../lib/sectionTabs'

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
  const t = useT()
  const { formatLocale } = useLocale()
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
        throw new Error(t('ops.report.errNoCage'))
      }
      if (!dateRange.startDate || !dateRange.endDate) {
        throw new Error(t('ops.report.errNoRange'))
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

  const TYPES = ['production', 'feed', 'growth', 'mortality', 'financial']
  const fmtDate = (d) => new Date(d).toLocaleDateString(formatLocale)
  const shownType = reportData?.reportType || reportType

  const table = (() => {
    if (shownType === 'production') {
      return {
        title: t('ops.report.table.byCage'),
        columns: [
          { key: 'cage_name', header: t('ops.report.col.cage') },
          { key: 'status', header: t('ops.report.col.status'), render: (r) => <span className="text-muted">{r.status}</span> },
          { key: 'current_count', header: t('ops.report.col.count'), align: 'right' },
          { key: 'feed_kg', header: t('ops.report.col.feedKg'), align: 'right', render: (r) => Number(r.feed_kg).toFixed(1) },
          { key: 'mortality', header: t('ops.report.col.mortality'), align: 'right' },
          { key: 'latest_abw', header: t('ops.report.col.abw'), align: 'right', render: (r) => (r.latest_abw != null ? Number(r.latest_abw).toFixed(1) : '—') },
          { key: 'harvest', header: t('ops.report.col.harvestKg'), align: 'right', render: (r) => Number(r.harvest_weight_kg).toFixed(1) },
        ],
      }
    }
    if (shownType === 'feed') {
      return {
        title: t('ops.report.table.feed'),
        columns: [
          { key: 'date', header: t('ops.report.col.date') },
          { key: 'cage', header: t('ops.report.col.cage') },
          { key: 'feed_kg', header: t('ops.report.col.feedKg'), align: 'right' },
          { key: 'feed_cost', header: t('ops.report.col.cost'), align: 'right' },
          { key: 'mortality', header: t('ops.report.col.mortality'), align: 'right' },
        ],
      }
    }
    if (shownType === 'growth') {
      return {
        title: t('ops.report.table.growth'),
        columns: [
          { key: 'date', header: t('ops.report.col.date') },
          { key: 'cage', header: t('ops.report.col.cage') },
          { key: 'batch_code', header: t('ops.report.col.batch') },
          { key: 'abw', header: t('ops.report.col.abw'), align: 'right' },
          { key: 'fish_count', header: t('ops.report.col.fish'), align: 'right' },
          { key: 'total_weight', header: t('ops.report.col.weight'), align: 'right' },
        ],
      }
    }
    if (shownType === 'mortality') {
      return {
        title: t('ops.report.table.mortality'),
        columns: [
          { key: 'date', header: t('ops.report.col.date') },
          { key: 'cage', header: t('ops.report.col.cage') },
          { key: 'mortality', header: t('ops.report.col.mortality'), align: 'right' },
          { key: 'notes', header: t('ops.report.col.notes') },
        ],
      }
    }
    return {
      title: t('ops.report.table.financial'),
      columns: [
        { key: 'date', header: t('ops.report.col.date') },
        { key: 'cage', header: t('ops.report.col.cage') },
        { key: 'feed_kg', header: t('ops.report.col.feedKg'), align: 'right' },
        { key: 'unit_price', header: t('ops.report.col.unitPrice'), align: 'right' },
        { key: 'feed_cost', header: t('ops.report.col.cost'), align: 'right' },
      ],
    }
  })()

  return (
    <Layout
      title={t('ops.report.title')}
      eyebrow={t('ops.reportsTab.eyebrow')}
      actions={
        reportData ? (
          <>
            <GradientButton icon={Download} onClick={downloadReport}>
              {t('ops.report.download')}
            </GradientButton>
            <GradientButton reverse icon={Printer} onClick={() => window.print()}>
              {t('ops.report.print')}
            </GradientButton>
          </>
        ) : null
      }
    >
      <div className="flex flex-col gap-[28px]">
        <div className="print:hidden">
          <NavTabs tabs={reportTabs(t)} label={t('ops.tabs.reports')} />
        </div>
        <div className="grid grid-cols-1 gap-[20px] lg:grid-cols-4">
          <div className="lg:col-span-1 print:hidden">
            <Panel title={t('ops.report.options')} titleId="report-options">
              <div className="flex flex-col gap-5 border-t border-line pt-4">
                <Field label={t('ops.report.type')} htmlFor="report-type">
                  <Select id="report-type" value={reportType} onChange={(e) => setReportType(e.target.value)}>
                    {TYPES.map((type) => (
                      <option key={type} value={type}>
                        {t(`ops.report.types.${type}`)}
                      </option>
                    ))}
                  </Select>
                </Field>

                <fieldset className="flex flex-col gap-2">
                  <legend className="mb-2 text-xs leading-4 text-muted">{t('ops.report.dateRange')}</legend>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <Field label={t('ops.ledger.from')} htmlFor="report-start">
                      <Input id="report-start" type="date" name="startDate" value={dateRange.startDate} onChange={handleDateRangeChange} />
                    </Field>
                    <Field label={t('ops.ledger.to')} htmlFor="report-end">
                      <Input id="report-end" type="date" name="endDate" value={dateRange.endDate} onChange={handleDateRangeChange} />
                    </Field>
                  </div>
                </fieldset>

                <fieldset>
                  <legend className="mb-2 text-xs leading-4 text-muted">{t('ops.report.cages')}</legend>
                  <div className="max-h-60 overflow-y-auto rounded-[14px] border border-line bg-bg px-3 py-1">
                    <label htmlFor="select-all" className="flex min-h-10 cursor-pointer items-center gap-3 text-sm font-medium text-text">
                      <input
                        type="checkbox"
                        id="select-all"
                        checked={selectedCages.length === cages.length && cages.length > 0}
                        onChange={handleSelectAllCages}
                        className="h-4 w-4 rounded accent-[var(--cyan)]"
                      />
                      {t('ops.report.selectAll')}
                    </label>
                    <div className="border-t border-line pt-1">
                      {cages.map((cage) => {
                        const id = cageKey(cage)
                        return (
                          <label key={id} htmlFor={`cage-${id}`} className="flex min-h-10 cursor-pointer items-center gap-3 text-sm text-text">
                            <input
                              type="checkbox"
                              id={`cage-${id}`}
                              checked={selectedCages.includes(id)}
                              onChange={() => handleCageToggle(id)}
                              className="h-4 w-4 rounded accent-[var(--cyan)]"
                            />
                            <span>
                              {cage.name}
                              {cage.status !== 'active' && <span className="ml-2 text-xs text-muted">({cage.status})</span>}
                            </span>
                          </label>
                        )
                      })}
                      {cagesResult === undefined && <LoadingState label={t('ops.report.loadingCages')} />}
                      {cagesResult !== undefined && cages.length === 0 && (
                        <p className="py-2 text-sm text-muted">{t('ops.report.noCages')}</p>
                      )}
                    </div>
                  </div>
                </fieldset>

                <GradientButton variant="solid" icon={BarChart} onClick={generateReport} disabled={loading} className="w-full justify-center">
                  {loading ? t('ops.report.generating') : t('ops.report.generate')}
                </GradientButton>

                {error && (
                  <p role="alert" className="rounded-[14px] border border-alert/40 bg-alert/10 p-3 text-sm text-alert">
                    {error}
                  </p>
                )}
              </div>
            </Panel>
          </div>

          <div className="flex min-w-0 flex-col gap-[20px] lg:col-span-3 print:col-span-4">
            {!reportData ? (
              <section className="flex min-h-[18rem] flex-col items-center justify-center gap-1 rounded-card border border-line bg-surface px-6 py-10 text-center shadow-[var(--shadow-card)]">
                <h2 className="text-base font-semibold leading-[18px] text-text">{t('ops.report.emptyTitle')}</h2>
                <p className="max-w-md text-sm text-muted">{t('ops.report.emptyBody')}</p>
              </section>
            ) : (
              <div id="report-content" className="flex flex-col gap-[20px]">
                <header className="flex flex-col gap-1">
                  <h2 className="text-[20px] font-semibold leading-6 text-text">{t(`ops.report.heading.${shownType}`)}</h2>
                  <p className="text-sm leading-4 text-muted tabular-nums">
                    {t('ops.report.range', { from: fmtDate(reportData.dateRange.startDate), to: fmtDate(reportData.dateRange.endDate) })} ·{' '}
                    {t('ops.report.generated', { at: new Date(reportData.generatedAt).toLocaleString(formatLocale) })}
                  </p>
                </header>

                <KpiStrip
                  items={[
                    { label: t('ops.report.kpi.feed'), value: Number(summary.total_feed_kg || 0).toFixed(1), suffix: 'kg' },
                    { label: t('ops.report.kpi.mortality'), value: summary.total_mortality || 0, suffix: t('ops.report.kpi.fish') },
                    { label: t('ops.report.kpi.feedCost'), value: money(summary.total_feed_cost || 0) },
                  ]}
                />
                <KpiStrip
                  items={[
                    { label: t('ops.report.kpi.fcr'), value: summary.avg_fcr != null ? Number(summary.avg_fcr).toFixed(2) : '—' },
                    {
                      label: t('ops.report.kpi.growth'),
                      value: summary.avg_growth_g_day != null ? Number(summary.avg_growth_g_day).toFixed(2) : '—',
                      suffix: summary.avg_growth_g_day != null ? t('ops.report.kpi.gDay') : undefined,
                    },
                    { label: t('ops.report.kpi.harvest'), value: Number(summary.harvest_weight_kg || 0).toFixed(1), suffix: 'kg' },
                  ]}
                />

                <Table
                  title={table.title}
                  columns={table.columns}
                  rows={shownType === 'production' ? byCage : rowsForType()}
                  rowKey={(r, i) => r.cage_id || r.id || r._id || i}
                  empty={t('ops.report.noRows')}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  )
}
