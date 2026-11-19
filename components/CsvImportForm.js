import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { FileSpreadsheet } from 'lucide-react'
import { api } from '../convex/_generated/api'
import { useAuth } from '../contexts/AuthContext'
import { useLocation } from '../contexts/LocationContext'
import {
  buildBiweeklyRecords,
  buildDailyRecords,
  parseCsv,
  toServerRecords,
} from '../lib/csvImport'
import { errorMessage } from '../lib/errorMessage'
import { formatNumber, localToday } from '../lib/format'
import { useT } from '../lib/i18n/context'
import { Card, GhostButton, GradientButton, Pill, StatusDot, Table } from './ui'
import { ActionBar } from './ui/ActionBar'

const KINDS = {
  daily: {
    columns: 'cage_name, date, feed_amount, feed_type, feed_price, mortality, notes',
    mutation: api.dailyRecords.createMany,
    needsFeedTypes: true,
    build: buildDailyRecords,
  },
  biweekly: {
    columns: 'cage_name, date, batch_code, average_body_weight, total_fish_count, total_weight',
    mutation: api.biweeklyRecords.createMany,
    needsFeedTypes: false,
    build: buildBiweeklyRecords,
  },
}

/** Header row for each import, as a list (template download). */
export const CSV_COLUMNS = Object.fromEntries(
  Object.entries(KINDS).map(([kind, c]) => [kind, c.columns.split(',').map((s) => s.trim())]),
)

const cell = (values, ...names) => {
  for (const n of names) {
    const v = values?.[n]
    if (v != null && v !== '') return v
  }
  return ''
}

const formatSize = (bytes) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`

/**
 * Bulk CSV upload (MOBILE-009, Paper 53 + P-UPLOAD). The file is parsed in
 * the browser as soon as it is chosen and checked with the same rules as
 * interactive entry; every row is listed with its status before anything is
 * sent. Rows that fail a rule are skipped and named with their line number.
 * `header` renders at the top of the upload card (the page's kind picker).
 */
export default function CsvImportForm({ kind, onSuccess, onCancel, header = null }) {
  const t = useT()
  const config = KINDS[kind]
  const inputId = `${kind}-csv`
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [text, setText] = useState(null)
  const [dragging, setDragging] = useState(false)
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const { user } = useAuth()
  const { locationArgs } = useLocation()
  const cages = useQuery(api.cages.list, user ? locationArgs : 'skip')
  const feedTypes = useQuery(api.feed.listFeedTypes, user && config.needsFeedTypes ? {} : 'skip')
  const lookupsReady = cages !== undefined && (!config.needsFeedTypes || feedTypes !== undefined)
  const createMany = useMutation(config.mutation)

  const choose = async (next) => {
    setFile(next || null)
    setResult(null)
    setError('')
    setFilter('all')
    setText(next ? await next.text() : null)
  }

  useEffect(() => {
    if (inputRef.current && !file) inputRef.current.value = ''
  }, [file])

  // Parse and check on choose, so the rows can be reviewed before import.
  const preview = useMemo(() => {
    if (text == null || !lookupsReady) return null
    let parsed
    try {
      parsed = parseCsv(text)
    } catch (err) {
      if (err.code === 'UNCLOSED_QUOTE') return { error: t('csvImport.unclosedQuote', { line: err.line }) }
      if (err.code === 'EMPTY') return { error: t('csvImport.empty') }
      return { error: errorMessage(err, t('csvImport.failed')) }
    }
    const lookups = config.needsFeedTypes ? { cages, feedTypes } : { cages }
    const { records, skipped } = config.build(parsed.rows, { ...lookups, today: localToday() })
    const skippedByLine = new Map(skipped.map((s) => [s.line, s]))
    const rows = parsed.rows.map(({ line, values }) => ({
      line,
      values,
      skip: skippedByLine.get(line) || null,
    }))
    return { parsed, records, skipped, rows }
  }, [text, lookupsReady, cages, feedTypes, config, t])

  const handleImport = async () => {
    if (!file) {
      setError(t('csvImport.chooseFile'))
      return
    }
    if (!preview || preview.error) return
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const { records, skipped, parsed } = preview
      let inserted = 0
      if (records.length) {
        const ids = await createMany({ records: toServerRecords(records) })
        inserted = Array.isArray(ids) ? ids.length : 0
      }
      setResult({
        rows: parsed.rows.length,
        inserted,
        existing: records.length - inserted,
        skipped,
      })
      setFile(null)
      setText(null)
      if (inserted > 0) onSuccess?.()
    } catch (err) {
      setError(errorMessage(err, t('csvImport.failed')))
    } finally {
      setLoading(false)
    }
  }

  const cancel = () => {
    choose(null)
    onCancel?.()
  }

  const okCount = preview?.records?.length || 0
  const errorCount = preview?.skipped?.length || 0
  const totalCount = preview?.rows?.length || 0
  const shown = (preview?.rows || []).filter((r) =>
    filter === 'ok' ? !r.skip : filter === 'errors' ? Boolean(r.skip) : true,
  )

  const status = (r) =>
    r.skip ? (
      <span className="flex min-w-0 items-center gap-2.5">
        <Pill tone="red">{t('csvImport.preview.error')}</Pill>
        <span className="truncate text-xs text-muted">{t(r.skip.reason.key, r.skip.reason.params)}</span>
      </span>
    ) : (
      <Pill tone="green">{t('csvImport.preview.ok')}</Pill>
    )

  const columns = [
    {
      key: 'line',
      header: t('csvImport.preview.colRow'),
      width: 56,
      render: (r) => <span className="font-mono text-xs text-faint">{r.line}</span>,
    },
    { key: 'date', header: t('csvImport.preview.colDate'), width: 110, render: (r) => <span className="tabular-nums">{cell(r.values, 'date') || '—'}</span> },
    { key: 'cage', header: t('csvImport.preview.colCage'), width: 100, render: (r) => cell(r.values, 'cage_name', 'cage') || '—' },
    ...(kind === 'daily'
      ? [
          { key: 'feed', header: t('csvImport.preview.colFeed'), width: 90, align: 'right', render: (r) => cell(r.values, 'feed_amount', 'feed_kg', 'feed') || '—' },
          { key: 'mort', header: t('csvImport.preview.colMortality'), width: 100, align: 'right', render: (r) => cell(r.values, 'mortality', 'dead') || '—' },
        ]
      : [
          { key: 'batch', header: t('csvImport.preview.colBatch'), width: 130, render: (r) => cell(r.values, 'batch_code', 'batch') || '—' },
          { key: 'abw', header: t('csvImport.preview.colAbw'), width: 90, align: 'right', render: (r) => cell(r.values, 'average_body_weight', 'abw') || '—' },
          { key: 'fish', header: t('csvImport.preview.colFish'), width: 100, align: 'right', render: (r) => cell(r.values, 'total_fish_count', 'fish_count') || '—' },
        ]),
    { key: 'status', header: t('csvImport.preview.colStatus'), render: status },
  ]

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    const dropped = e.dataTransfer?.files?.[0]
    if (dropped) choose(dropped)
  }

  return (
    <div className="flex flex-col gap-7">
      <Card padding={false} className="flex flex-col gap-5 px-5 py-6 sm:px-[26px]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {header}
          <p className="text-[13px] leading-4 text-muted">{t('csvImport.columnsLine', { columns: config.columns })}</p>
        </div>

        {error && (
          <div
            role="alert"
            className="rounded-input border border-[var(--pill-red-border)] bg-[color-mix(in_oklab,var(--alert)_8%,transparent)] px-4 py-3 text-sm text-alert"
          >
            {error}
          </div>
        )}
        {preview?.error && (
          <div
            role="alert"
            className="rounded-input border border-[var(--pill-red-border)] bg-[color-mix(in_oklab,var(--alert)_8%,transparent)] px-4 py-3 text-sm text-alert"
          >
            {preview.error}
          </div>
        )}
        {result && <CsvImportReport result={result} />}

        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex flex-col gap-4 rounded-input border-[1.5px] border-dashed bg-[color-mix(in_oklab,var(--bg)_50%,var(--surface))] p-5 sm:flex-row sm:items-center sm:gap-5 sm:p-7 ${
            dragging ? 'border-pearl-cyan' : 'border-line-strong'
          }`}
        >
          <div className="flex size-[52px] shrink-0 items-center justify-center rounded-full bg-surface-2 text-pearl-cyan">
            <FileSpreadsheet size={22} strokeWidth={2} aria-hidden />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="truncate text-[15px] font-semibold leading-[18px] text-text">
              {file ? file.name : t('csvImport.dropTitle')}
            </p>
            <p className="text-[13px] leading-4 text-muted tabular-nums">
              {file
                ? preview && !preview.error
                  ? t('csvImport.fileMeta', { size: formatSize(file.size), rows: formatNumber(totalCount) })
                  : formatSize(file.size)
                : t('csvImport.fileHint')}
            </p>
          </div>
          <label htmlFor={inputId} className="sr-only">
            {t('csvImport.file')}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => choose(e.target.files?.[0] || null)}
            className="sr-only"
          />
          <GhostButton size="lg" onClick={() => inputRef.current?.click()}>
            {file ? t('csvImport.chooseAnother') : t('csvImport.chooseFileButton')}
          </GhostButton>
        </div>
        {file && !lookupsReady && <p className="text-sm text-muted">{t('common.loading')}</p>}
      </Card>

      {preview && !preview.error && (
        <Table
          title={t('csvImport.preview.title')}
          tabsLabel={t('csvImport.preview.title')}
          tabs={[
            { value: 'all', label: t('csvImport.preview.tabAll', { count: totalCount }) },
            { value: 'ok', label: t('csvImport.preview.tabOk', { count: okCount }) },
            ...(errorCount
              ? [
                  {
                    value: 'errors',
                    label: <span className="text-alert">{t('csvImport.preview.tabErrors', { count: errorCount })}</span>,
                  },
                ]
              : []),
          ]}
          tab={filter}
          onTabChange={setFilter}
          actions={<span className="text-[13px] leading-4 text-muted">{t('csvImport.preview.note')}</span>}
          columns={columns}
          rows={shown}
          rowKey={(r) => r.line}
          empty={t('csvImport.preview.empty')}
        />
      )}

      {file && preview && !preview.error && (
        <ActionBar aria-live="polite">
          <div className="mr-auto flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
            <span className="flex items-center gap-2">
              <StatusDot tone={okCount ? 'good' : 'alert'} size={8} />
              <span className="text-[14px] leading-[18px] text-text tabular-nums">{t('csvImport.readyCount', { count: okCount })}</span>
            </span>
            {errorCount > 0 && (
              <span className="text-[13px] leading-4 text-muted tabular-nums">{t('csvImport.skipCount', { count: errorCount })}</span>
            )}
          </div>
          <button
            type="button"
            onClick={cancel}
            className="min-h-11 rounded-pill px-[18px] text-[14px] leading-[18px] text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan"
          >
            {t('common.cancel')}
          </button>
          <GradientButton variant="solid" onClick={handleImport} disabled={loading || !okCount}>
            {loading ? t('csvImport.uploading') : t('csvImport.importCount', { count: okCount })}
          </GradientButton>
        </ActionBar>
      )}
    </div>
  )
}

export function CsvImportReport({ result }) {
  const t = useT()
  const { rows, inserted, existing, skipped } = result
  const tone =
    inserted > 0 && skipped.length === 0
      ? 'text-good border-[var(--pill-green-border)] bg-[color-mix(in_oklab,var(--good)_8%,transparent)]'
      : 'text-text border-[var(--pill-amber-border)] bg-[color-mix(in_oklab,var(--warn)_8%,transparent)]'
  return (
    <div role="status" className={`text-sm border rounded-input px-4 py-3 space-y-2 ${tone}`}>
      <p className="font-semibold">{t('csvImport.summary', { inserted, rows })}</p>
      {existing > 0 && <p>{t('csvImport.existing', { count: existing })}</p>}
      {skipped.length > 0 && (
        <div>
          <p className="font-semibold">{t('csvImport.skippedTitle', { count: skipped.length })}</p>
          <ul className="mt-1 max-h-60 overflow-auto list-disc pl-5 space-y-0.5">
            {skipped.map((s, i) => (
              <li key={`${s.line}-${i}`}>
                {t('csvImport.lineReason', {
                  line: s.line,
                  reason: t(s.reason.key, s.reason.params),
                })}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
