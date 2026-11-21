import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useConvex, useMutation } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { useLocation } from '../../contexts/LocationContext'
import { useToast } from '../Toast'
import { GradientButton } from '../ui'
import { useLocale, useT } from '../../lib/i18n/context'
import { localToday } from '../../lib/format'
import {
  CHECK_CHUNK,
  IMPORT_CHUNK,
  IMPORT_COLUMNS,
  IMPORT_KINDS,
  MAX_IMPORT_ROWS,
  formatFileSize,
  isIsoDate,
  missingColumns,
  parseCsv,
  summarizeCheck,
  templateCsv,
  toImportRows,
} from '../../lib/csvImport'

/** Rows per page of the check table. */
const PAGE_SIZE = 50

/*
 * Light-theme overrides are written out in full: Tailwind only generates
 * classes it finds as literal text, so a `${prefix}:class` template is never
 * built. Where the theme tokens already hold Paper's value (line, line-strong,
 * bg, text, muted, faint, warn, alert, sky-ink) the token is used instead.
 */
/** Paper 53 text is proportional (the app body sets tabular-nums). */
const PROPORTIONAL = '[font-variant-numeric:normal]'

/** Paper 53 icons (stroke 2, round caps). */
function Svg({ size, children, className = '' }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      {children}
    </svg>
  )
}
export function DownloadIcon({ size = 16 }) {
  return (
    <Svg size={size}>
      <path d="M12 3v12m0 0l-5-5m5 5l5-5M4 21h16" />
    </Svg>
  )
}
function UploadArrowIcon({ size = 16 }) {
  return (
    <Svg size={size} className="text-[#0A0B0C] [html[data-theme=light]_&]:text-[#0B0D10]">
      <path d="M12 21V9m0 0l-5 5m5-5l5 5M4 3h16" />
    </Svg>
  )
}
function FileUploadIcon() {
  return (
    <Svg size={22} className="text-sky-ink">
      <path d="M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8zM14 3v5h5M9 14l3-3 3 3M12 11v7" />
    </Svg>
  )
}

/**
 * Number columns per kind. Daily follows Paper 53 (Feed 80, Mortality 80,
 * DO 70); the other tabs keep the same widths. `fields` are the server's
 * row-result fields that colour the cell.
 */
const NUMBER_COLUMNS = {
  daily: [
    { key: 'colFeed', field: 'feed', fields: ['feed', 'feedType', 'feedPrice'], unit: 'kg', width: 'w-[80px]' },
    { key: 'colMortality', field: 'mortality', fields: ['mortality'], width: 'w-[80px]' },
    { key: 'colDo', field: 'doMgl', fields: ['do', 'temp'], width: 'w-[70px]' },
  ],
  biweekly: [
    { key: 'colAbw', field: 'abw', fields: ['abw'], unit: 'g', width: 'w-[80px]' },
    { key: 'colFish', field: 'fishCount', fields: ['fishCount'], width: 'w-[80px]' },
    { key: 'colWeight', field: 'totalWeight', fields: ['totalWeight', 'batch'], unit: 'kg', width: 'w-[70px]' },
  ],
  stocking: [
    { key: 'colFish', field: 'fishCount', fields: ['fishCount', 'batch'], width: 'w-[80px]' },
    { key: 'colAbw', field: 'abw', fields: ['abw'], unit: 'g', width: 'w-[80px]' },
    { key: 'colBiomass', field: 'biomass', fields: ['biomass'], unit: 'kg', width: 'w-[70px]' },
  ],
}

/** Paper 53 status pills (FBD-0 dark, M7Z-0 light). */
const STATUS_PILL = {
  ok: 'border-[#2E5A3E] text-[#86EFAC] [html[data-theme=light]_&]:border-[#A7DDB8] [html[data-theme=light]_&]:text-[#15803D]',
  warning: 'border-[#5E4A1E] text-warn [html[data-theme=light]_&]:border-[#F1D39A]',
  error: 'border-[#6B3A3A] text-alert [html[data-theme=light]_&]:border-[#F3B8B8]',
}

/** The offending cell: warn colour for a warning, alert colour for an error. */
function flagged(result, fields) {
  if (!result?.field || !fields.includes(result.field)) return ''
  return result.status === 'warning' ? 'text-warn' : 'text-alert'
}

function downloadTemplate(kind) {
  const url = URL.createObjectURL(new Blob([templateCsv(kind)], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `anowa-${kind}-template.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** "Download template" (Paper 53 header): sky ring, 42px, 16px download icon. */
export function DownloadTemplateButton({ kind }) {
  const t = useT()
  return (
    <GradientButton ring="sky" size="bar" icon={DownloadIcon} onClick={() => downloadTemplate(kind)}>
      {t('csvImport.page.template')}
    </GradientButton>
  )
}

/** Paper 53 segmented tabs: Daily records · Biweekly sampling · Stocking. */
function KindTabs({ value, onChange }) {
  const t = useT()
  const labels = {
    daily: t('csvImport.page.kindDaily'),
    biweekly: t('csvImport.page.kindBiweekly'),
    stocking: t('csvImport.page.kindStocking'),
  }
  return (
    <div
      role="radiogroup"
      aria-label={t('csvImport.page.kindLabel')}
      className="inline-flex w-fit flex-wrap gap-1 rounded-pill border border-line bg-bg p-1"
    >
      {IMPORT_KINDS.map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          onClick={() => onChange(k)}
          className={`rounded-pill px-[18px] py-2 text-[13px] leading-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
            value === k ? 'bg-button font-medium text-button-text' : 'text-muted hover:text-text'
          }`}
        >
          {labels[k]}
        </button>
      ))}
    </div>
  )
}

function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** "just now" for the first minute, then "2 minutes ago". */
function useUploadedWhen(at) {
  const t = useT()
  const { formatLocale } = useLocale()
  const now = useNow()
  if (!at) return ''
  const minutes = Math.floor((Math.max(now, at) - at) / 60000)
  if (minutes < 1) return t('csvImport.justNow')
  const rtf = new Intl.RelativeTimeFormat(formatLocale || undefined, { numeric: 'auto' })
  return minutes < 60 ? rtf.format(-minutes, 'minute') : rtf.format(-Math.floor(minutes / 60), 'hour')
}

/**
 * Drop zone (Paper 53): dashed 1.5px box. Empty until a file is chosen, then
 * the file name and "N rows · size · uploaded just now · drop another file
 * to replace". Drag and drop or "Choose file".
 */
function DropZone({ file, onFile, problem }) {
  const t = useT()
  const inputRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  const when = useUploadedWhen(file?.at)
  const pick = (f) => f && onFile(f)
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        pick(e.dataTransfer.files?.[0])
      }}
      className={`flex flex-col gap-4 rounded-[14px] border-[1.5px] border-dashed bg-[#0E1012] p-5 sm:flex-row sm:items-center sm:gap-5 sm:p-[28px] [html[data-theme=light]_&]:bg-bg ${
        dragging ? 'border-sky-ink' : 'border-line-strong'
      }`}
    >
      <span className="flex size-[52px] shrink-0 items-center justify-center rounded-full bg-surface-2 [html[data-theme=light]_&]:bg-surface">
        <FileUploadIcon />
      </span>
      <div className="flex min-w-0 grow flex-col gap-1">
        <div className="truncate text-[15px] font-semibold leading-[18px] text-text">
          {file ? file.name : t('csvImport.dropTitle')}
        </div>
        <div className={`text-[13px] leading-4 ${problem ? 'text-alert' : 'text-muted'}`} aria-live="polite">
          {problem ||
            (file
              ? t('csvImport.fileMetaFull', { count: file.rows, size: formatFileSize(file.size), when })
              : t('csvImport.dropHint', { max: MAX_IMPORT_ROWS.toLocaleString() }))}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          pick(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="shrink-0 self-start rounded-pill border border-line-strong px-[18px] py-[9px] text-[13px] leading-4 text-text hover:bg-surface-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan sm:self-auto"
      >
        {t('csvImport.chooseFileButton')}
      </button>
    </div>
  )
}

function useCellFormat() {
  const { formatLocale } = useLocale()
  return useMemo(() => {
    const loc = formatLocale || undefined
    const dateFmt = new Intl.DateTimeFormat(loc, { month: 'short', day: '2-digit', timeZone: 'UTC' })
    const rangeFmt = new Intl.DateTimeFormat(loc, { month: 'short', day: 'numeric', timeZone: 'UTC' })
    const at = (s) => new Date(`${s}T12:00:00Z`)
    return {
      date: (s) => (isIsoDate(s) ? dateFmt.format(at(s)) : s),
      range: (from, to) => {
        if (!from) return ''
        if (from === to) return rangeFmt.format(at(from))
        return typeof rangeFmt.formatRange === 'function'
          ? rangeFmt.formatRange(at(from), at(to)).replace(/\s*–\s*/, '–')
          : `${rangeFmt.format(at(from))}–${rangeFmt.format(at(to))}`
      },
    }
  }, [formatLocale])
}

function Cell({ value, unit, className = '', align = '' }) {
  const blank = value === undefined || value === null || value === ''
  return (
    <div className={`shrink-0 truncate text-[14px] leading-[18px] ${align} ${className} ${blank ? '!text-faint' : ''}`}>
      {blank ? '—' : unit ? `${value} ${unit}` : value}
    </div>
  )
}

/** Paper 53 "Check rows": filter chips, the per-kind columns and a status per row. Pages through big files. */
function CheckTable({ kind, rows, results, counts }) {
  const t = useT()
  const fmt = useCellFormat()
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  useEffect(() => setPage(0), [filter, rows])
  const resultByLine = useMemo(() => new Map((results || []).map((r) => [r.line, r])), [results])
  const visible = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => resultByLine.get(r.line)?.status === filter)),
    [rows, filter, resultByLine],
  )
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const shown = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const cols = NUMBER_COLUMNS[kind]
  // Paper 53: the chosen view reads in text colour ("All 52"), OK in muted;
  // Warnings and Errors keep their tone.
  const chips = [
    { value: 'all', label: t('csvImport.preview.tabAll', { count: counts.all }) },
    { value: 'ok', label: t('csvImport.preview.tabOk', { count: counts.ok }) },
    { value: 'warning', label: t('csvImport.preview.tabWarnings', { count: counts.warning }), tone: 'text-warn' },
    { value: 'error', label: t('csvImport.preview.tabErrors', { count: counts.error }), tone: 'text-alert' },
  ]
  const head = 'shrink-0 text-[11px] uppercase leading-[14px] tracking-[0.08em] text-faint'
  const divider = 'border-t border-line'
  return (
    <section className={`flex flex-col rounded-card border border-line bg-surface shadow-[var(--shadow-card)] ${PROPORTIONAL}`}>
      <div className="flex flex-col gap-3 border-b border-line px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <h2 className="text-[17px] font-semibold leading-[22px] text-text">{t('csvImport.preview.title')}</h2>
          <div className="flex flex-wrap gap-4" role="group" aria-label={t('csvImport.preview.filter')}>
            {chips.map((c) => (
              <button
                key={c.value}
                type="button"
                aria-pressed={filter === c.value}
                onClick={() => setFilter(c.value)}
                className={`rounded text-[13px] leading-4 hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan ${
                  c.tone || (filter === c.value ? 'text-text' : 'text-muted')
                } ${c.tone && filter === c.value ? 'underline underline-offset-4' : ''}`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[13px] leading-4 text-muted">{t('csvImport.preview.note')}</p>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[720px]" role="table" aria-label={t('csvImport.preview.title')}>
          <div className="flex items-center gap-6 px-6 py-3" role="row">
            <div className={`w-[36px] ${head}`} role="columnheader">
              {t('csvImport.preview.colRow')}
            </div>
            <div className={`w-[70px] ${head}`} role="columnheader">
              {t('csvImport.preview.colDate')}
            </div>
            <div className={`w-[60px] ${head}`} role="columnheader">
              {t('csvImport.preview.colCage')}
            </div>
            {cols.map((c) => (
              <div key={c.key} className={`${c.width} text-right ${head}`} role="columnheader">
                {t(`csvImport.preview.${c.key}`)}
              </div>
            ))}
            <div className={`min-w-0 grow basis-0 ${head}`} role="columnheader">
              {t('csvImport.preview.colStatus')}
            </div>
          </div>
          {shown.length === 0 && (
            <div className={`${divider} px-6 py-[14px] text-[13px] leading-4 text-muted`}>{t('csvImport.preview.empty')}</div>
          )}
          {shown.map((row) => {
            const r = resultByLine.get(row.line)
            const status = r?.status
            return (
              <div key={row.line} role="row" className={`flex items-center gap-6 px-6 py-[14px] ${divider}`}>
                <div className="w-[36px] shrink-0 font-geist text-xs leading-4 text-faint" role="cell">
                  {row.line}
                </div>
                <Cell value={fmt.date(row.date)} className={`w-[70px] ${flagged(r, ['date']) || 'text-text'}`} />
                <Cell value={row.cage} className={`w-[60px] ${flagged(r, ['cage']) || 'text-text'}`} />
                {cols.map((c) => (
                  <Cell
                    key={c.key}
                    value={row[c.field]}
                    unit={c.unit}
                    align="text-right"
                    className={`${c.width} ${flagged(r, c.fields) || 'text-text'}`}
                  />
                ))}
                <div className="flex min-w-0 grow basis-0 items-center gap-2.5" role="cell">
                  {status ? (
                    <>
                      <span className={`shrink-0 rounded-pill border px-3 py-1 text-xs leading-4 ${STATUS_PILL[status]}`}>
                        {t(`csvImport.preview.${status}`)}
                      </span>
                      {r.reason && (
                        <span className="min-w-0 text-xs leading-4 text-muted">
                          {t(`csvImport.reason.${r.reason.code}`, r.reason.params || {})}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-xs leading-4 text-faint">{t('csvImport.checking')}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {pages > 1 && (
        <div className={`flex items-center justify-between gap-3 px-6 py-3 text-[13px] leading-4 text-muted ${divider}`}>
          <span>
            {t('csvImport.preview.range', {
              from: page * PAGE_SIZE + 1,
              to: Math.min(visible.length, (page + 1) * PAGE_SIZE),
              total: visible.length,
            })}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-pill border border-line-strong px-3 py-1.5 text-text disabled:opacity-40"
            >
              {t('csvImport.preview.prev')}
            </button>
            <button
              type="button"
              disabled={page >= pages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-pill border border-line-strong px-3 py-1.5 text-text disabled:opacity-40"
            >
              {t('csvImport.preview.next')}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}

/** Checks the rows in CHECK_CHUNK chunks, one call after another, carrying the file state between them. */
function useChunkedCheck(rows, locationId, today) {
  const convex = useConvex()
  const [state, setState] = useState({ results: null, done: false, error: '' })
  useEffect(() => {
    if (!rows) {
      setState({ results: null, done: false, error: '' })
      return undefined
    }
    let cancelled = false
    setState({ results: [], done: false, error: '' })
    ;(async () => {
      const results = []
      let carry
      try {
        for (let i = 0; i < rows.list.length; i += CHECK_CHUNK) {
          const res = await convex.query(api.bulkImport.check, {
            kind: rows.kind,
            today,
            rows: rows.list.slice(i, i + CHECK_CHUNK),
            ...(carry ? { carry } : {}),
            ...(locationId ? { locationId } : {}),
          })
          if (cancelled) return
          results.push(...res.results)
          carry = res.carry
          setState({ results: [...results], done: i + CHECK_CHUNK >= rows.list.length, error: '' })
        }
      } catch (err) {
        if (!cancelled) setState({ results, done: false, error: err?.data?.message || err?.data || err?.message || 'error' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [convex, rows, locationId, today])
  return state
}

/**
 * Paper 53 Bulk import body (FBD-0 / M7Z-0). The file is read in the
 * browser; its rows are checked by `bulkImport.check` in chunks against the
 * site's cages, stock and history; "Import N rows" sends the OK and warning
 * rows in chunks to `bulkImport.importRows`, which checks them again and
 * skips errors.
 */
export default function BulkImport({ kind, onKindChange }) {
  const t = useT()
  const fmt = useCellFormat()
  const { showToast } = useToast()
  const { locationArgs } = useLocation()
  const locationId = locationArgs?.locationId
  const [file, setFile] = useState(null)
  /** `{ kind, list }`: the parsed rows and the kind they were read as. */
  const [rows, setRows] = useState(null)
  const [problem, setProblem] = useState('')
  const [importing, setImporting] = useState(false)
  const importRows = useMutation(api.bulkImport.importRows)
  const [today] = useState(() => localToday())

  const reset = useCallback(() => {
    setFile(null)
    setRows(null)
    setProblem('')
  }, [])

  const readFile = useCallback(
    async (f, forKind) => {
      setProblem('')
      setRows(null)
      let text
      try {
        text = await f.text()
      } catch {
        setFile(null)
        setProblem(t('csvImport.unreadable'))
        return
      }
      const base = { name: f.name, size: f.size, at: Date.now(), raw: f }
      let parsed
      try {
        parsed = parseCsv(text)
      } catch (err) {
        setFile({ ...base, rows: 0 })
        setProblem(err.code === 'UNCLOSED_QUOTE' ? t('csvImport.unclosedQuote', { line: err.line }) : t('csvImport.empty'))
        return
      }
      setFile({ ...base, rows: parsed.rows.length })
      const missing = missingColumns(forKind, parsed.headers)
      if (missing.length) {
        setProblem(t('csvImport.missingColumns', { columns: missing.join(', ') }))
        return
      }
      if (parsed.rows.length > MAX_IMPORT_ROWS) {
        setProblem(
          t('csvImport.tooMany', { count: parsed.rows.length.toLocaleString(), max: MAX_IMPORT_ROWS.toLocaleString() }),
        )
        return
      }
      if (!parsed.rows.length) {
        setProblem(t('csvImport.empty'))
        return
      }
      setRows({ kind: forKind, list: toImportRows(parsed.rows) })
    },
    [t],
  )

  // A tab change re-reads the chosen file under the new kind's columns.
  const lastKind = useRef(kind)
  useEffect(() => {
    if (lastKind.current === kind) return
    lastKind.current = kind
    if (file?.raw) readFile(file.raw, kind)
  }, [kind, file, readFile])

  const check = useChunkedCheck(rows, locationId, today)
  const results = check.results
  const list = useMemo(() => rows?.list || [], [rows])
  const summary = useMemo(() => {
    const s = summarizeCheck(results || [], list)
    return { ...s, all: list.length }
  }, [results, list])
  const checked = Boolean(rows && check.done)

  const runImport = async () => {
    if (!checked || summary.ready === 0) return
    const passing = new Set(results.filter((r) => r.status !== 'error').map((r) => r.line))
    const toSend = list.filter((r) => passing.has(r.line))
    setImporting(true)
    let imported = 0
    try {
      for (let i = 0; i < toSend.length; i += IMPORT_CHUNK) {
        const res = await importRows({
          kind: rows.kind,
          rows: toSend.slice(i, i + IMPORT_CHUNK),
          ...(locationId ? { locationId } : {}),
        })
        imported += res.imported
      }
      const skipped = list.length - imported
      showToast(
        skipped > 0
          ? `${t('csvImport.done', { count: imported })} · ${t('csvImport.doneSkipped', { count: skipped })}`
          : t('csvImport.done', { count: imported }),
        'success',
      )
      reset()
    } catch (err) {
      const message = err?.data?.message || err?.data || err?.message || ''
      const failed = message ? `${t('csvImport.failed')}: ${message}` : t('csvImport.failed')
      showToast(imported > 0 ? `${t('csvImport.done', { count: imported })} · ${failed}` : failed, 'error')
    } finally {
      setImporting(false)
    }
  }

  const ready = summary.ready
  const summaryParts = checked
    ? [
        [t('csvImport.bar.ok', { count: summary.ok }), summary.warning ? t('csvImport.bar.warnings', { count: summary.warning }) : null]
          .filter(Boolean)
          .join(' + '),
        summary.error ? t('csvImport.bar.errors', { count: summary.error }) : null,
        summary.from ? fmt.range(summary.from, summary.to) : null,
        summary.cages ? t('csvImport.bar.cages', { count: summary.cages }) : null,
      ].filter(Boolean)
    : check.error
      ? [`${t('csvImport.checkFailed')}: ${check.error}`]
      : [t('csvImport.checkingProgress', { done: (results?.length || 0).toLocaleString(), total: list.length.toLocaleString() })]

  return (
    <>
      <section
        className={`flex flex-col gap-5 rounded-card border border-line bg-surface px-[26px] py-6 shadow-[var(--shadow-card)] ${PROPORTIONAL}`}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <KindTabs value={kind} onChange={onKindChange} />
          <p className="text-[13px] leading-4 text-muted">
            {t('csvImport.columnsLine', { columns: IMPORT_COLUMNS[kind].join(', ') })}
          </p>
        </div>
        <DropZone file={file} onFile={(f) => readFile(f, kind)} problem={problem} />
      </section>

      {rows && <CheckTable kind={rows.kind} rows={list} results={results} counts={summary} />}

      {rows && (
        <div
          className={`sticky bottom-[calc(var(--tabbar-h)+8px)] z-20 flex flex-col gap-3 rounded-[28px] border border-line-strong bg-surface-2 py-[14px] pl-6 pr-[14px] sm:flex-row sm:items-center sm:justify-between sm:gap-5 sm:rounded-pill lg:bottom-4 [html[data-theme=light]_&]:bg-surface [html[data-theme=light]_&]:shadow-[0_8px_24px_#1018281F,0_1px_2px_#1018281A] ${PROPORTIONAL}`}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1" aria-live="polite">
            <span className="flex items-center gap-2 text-[14px] leading-[18px] text-text">
              <span className="size-2 shrink-0 rounded-full bg-good [html[data-theme=light]_&]:bg-[#16A34A]" aria-hidden />
              {t('csvImport.readyCount', { count: checked ? ready : 0 })}
            </span>
            <span className={`text-[13px] leading-4 ${check.error ? 'text-alert' : 'text-muted'}`}>{summaryParts.join(' · ')}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <button
              type="button"
              onClick={reset}
              disabled={importing}
              className="rounded-pill px-[18px] py-[11px] text-[14px] leading-[18px] text-muted hover:text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
            <GradientButton
              variant="lime"
              size="bar"
              icon={UploadArrowIcon}
              onClick={runImport}
              disabled={importing || !checked || ready === 0}
            >
              {importing ? t('csvImport.importing') : t('csvImport.importCount', { count: checked ? ready : 0 })}
            </GradientButton>
          </div>
        </div>
      )}
    </>
  )
}
