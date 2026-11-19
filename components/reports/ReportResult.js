import { Component, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { periodLabel, reportCsv } from '../../convex/lib/reportCatalog'
import { Button, EmptyState, ErrorState, LoadingState } from '../ui'
import { useT } from '../../lib/i18n/context'
import { usePermission } from '../../hooks/usePermission'
import { errorMessage } from '../../lib/errorMessage'
import { columnLabel, formatCell, rowLabel } from './labels'

const ReportChart = dynamic(() => import('./ReportChart'), {
  ssr: false,
  loading: () => <div className="h-full animate-pulse rounded-lg bg-foam" />,
})

/** A failed run shows its message; changing the definition clears it. */
class RunBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }
  render() {
    if (this.state.error) return this.props.fallback(this.state.error)
    return this.props.children
  }
}

function slug(name) {
  return (
    String(name || 'report')
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_-]+/g, '-')
      .slice(0, 60) || 'report'
  )
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Rows with translated column labels and period keys made readable. */
function displayRows(result, definition) {
  return result.rows.map((row) =>
    definition.dimensions.includes('period') ? { ...row, period: periodLabel(row.period, definition.granularity) } : row,
  )
}

function ResultView({ definition, result, name }) {
  const t = useT()
  const canExport = usePermission('reports.export')
  const [busy, setBusy] = useState(false)
  const rows = useMemo(() => displayRows(result, definition), [result, definition])
  const columns = result.columns.map((c) => ({ ...c, label: columnLabel(t, definition.dataset, c) }))
  const chartMeasure = definition.chart.measure || definition.measures[0]
  const chartColumn = columns.find((c) => c.id === chartMeasure)
  const chartData = useMemo(
    () =>
      rows
        .filter((r) => typeof r[chartMeasure] === 'number')
        .slice(0, definition.chart.type === 'pie' ? 12 : 200)
        .map((r) => ({ name: rowLabel(r, definition.dimensions), value: r[chartMeasure] })),
    [rows, chartMeasure, definition],
  )
  const base = `${slug(name)}-${result.to ?? result.today}`

  const exportCsv = () => {
    download(new Blob(['\uFEFF' + reportCsv(columns, rows)], { type: 'text/csv;charset=utf-8' }), `${base}.csv`)
  }
  // xlsx (~400 kB) loads only when someone exports a workbook (MOBILE-008).
  const exportXlsx = async () => {
    setBusy(true)
    try {
      const XLSX = await import('xlsx')
      const sheet = XLSX.utils.aoa_to_sheet([
        columns.map((c) => c.label),
        ...rows.map((r) => columns.map((c) => r[c.id] ?? '')),
      ])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, sheet, 'Report')
      XLSX.writeFile(wb, `${base}.xlsx`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {result.from && result.to
            ? t('reportBuilder.result.period', { from: result.from, to: result.to })
            : t('reportBuilder.result.snapshot', { date: result.today })}
          {' · '}
          {t('reportBuilder.result.rows', { count: rows.length })}
        </p>
        {canExport && rows.length > 0 && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={exportCsv}>
              {t('reportBuilder.result.csv')}
            </Button>
            <Button variant="secondary" size="sm" onClick={exportXlsx} disabled={busy}>
              {busy ? t('reportBuilder.result.preparing') : t('reportBuilder.result.xlsx')}
            </Button>
          </div>
        )}
      </div>
      {result.sourceTruncated && (
        <p role="note" className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">
          {t('reportBuilder.result.sourceTruncated')}
        </p>
      )}
      {result.rowsTruncated && (
        <p role="note" className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">
          {t('reportBuilder.result.rowsTruncated')}
        </p>
      )}
      {!rows.length ? (
        <EmptyState title={t('reportBuilder.result.emptyTitle')} description={t('reportBuilder.result.emptyBody')} />
      ) : (
        <>
          {definition.chart.type !== 'table' && chartColumn && chartData.length > 0 && (
            <div className="h-72" aria-label={chartColumn.label} role="img">
              <ReportChart
                type={definition.chart.type}
                data={chartData}
                label={chartColumn.label}
                format={(v) => formatCell(v, chartColumn.format)}
              />
            </div>
          )}
          <div className="overflow-x-auto rounded-lg border border-foam-deep">
            <table className="min-w-full text-sm">
              <thead className="bg-foam text-left">
                <tr>
                  {columns.map((c) => (
                    <th
                      key={c.id}
                      scope="col"
                      className={`px-3 py-2 font-medium text-chart-ink ${c.kind === 'measure' ? 'text-right' : ''}`}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-foam-deep">
                    {columns.map((c) => (
                      <td key={c.id} className={`px-3 py-2 ${c.kind === 'measure' ? 'text-right tabular-nums' : ''}`}>
                        {c.kind === 'measure' ? formatCell(r[c.id], c.format) : (r[c.id] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function LiveResult({ definition, name }) {
  const result = useQuery(api.reportBuilder.preview, { definition })
  if (result === undefined) return <LoadingState />
  return <ResultView definition={definition} result={result} name={name} />
}

/** Runs `definition` live (reactive query) and shows table, chart and export. */
export default function ReportResult({ definition, name, problem }) {
  const t = useT()
  const key = JSON.stringify(definition)
  if (problem) return <EmptyState title={t('reportBuilder.result.incomplete')} description={problem} />
  return (
    <RunBoundary
      resetKey={key}
      fallback={(error) => <ErrorState title={t('reportBuilder.result.failed')} message={errorMessage(error)} />}
    >
      <LiveResult definition={definition} name={name} />
    </RunBoundary>
  )
}
