/**
 * CSV import (MOBILE-009, Paper 53): the parser and the column mapping for
 * the bulk import page.
 *
 * parseCsv handles RFC 4180 quoting (commas, quotes and line breaks inside
 * quoted fields), CRLF, a UTF-8 BOM, blank lines and semicolon-separated files
 * (Excel in French locales). Each row keeps its line number in the file so a
 * row can be reported where the user can find it.
 *
 * Rows are checked on the server (convex/bulkImport.ts) against the site's
 * cages, stock and history; this module only reads the file.
 */
/** Comma unless the header line has more semicolons than commas. */
export function detectDelimiter(text) {
  const first = String(text).split(/\r?\n/, 1)[0] || ''
  const count = (ch) => first.split(ch).length - 1
  return count(';') > count(',') ? ';' : ','
}

/**
 * Parse CSV text into { headers, rows }. Headers are trimmed and lower-cased;
 * each row is { line, values } where `values` maps header -> trimmed cell and
 * `line` is the 1-based line where the row starts. Throws when there is no
 * header or an unterminated quote.
 */
export function parseCsv(input, { delimiter } = {}) {
  let text = String(input ?? '')
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  const sep = delimiter || detectDelimiter(text)

  const records = []
  let field = ''
  let row = []
  let rowLine = 1
  let line = 1
  let inQuotes = false
  let quotedLine = 0

  const endRow = () => {
    row.push(field)
    records.push({ line: rowLine, cells: row })
    row = []
    field = ''
  }

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        if (ch === '\n') line += 1
        field += ch
      }
      continue
    }
    if (ch === '"' && field.trim() === '') {
      field = ''
      inQuotes = true
      quotedLine = line
    } else if (ch === sep) {
      row.push(field)
      field = ''
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1
      endRow()
      line += 1
      rowLine = line
    } else {
      field += ch
    }
  }
  if (inQuotes) {
    const err = new Error(`Unclosed quote starting on line ${quotedLine}`)
    err.code = 'UNCLOSED_QUOTE'
    err.line = quotedLine
    throw err
  }
  if (field !== '' || row.length) endRow()

  const nonBlank = records.filter((r) => r.cells.some((c) => c.trim() !== ''))
  if (!nonBlank.length) {
    const err = new Error('The file is empty')
    err.code = 'EMPTY'
    throw err
  }
  const [head, ...body] = nonBlank
  const headers = head.cells.map((h) => h.trim().toLowerCase())
  const rows = body.map((r) => {
    const values = {}
    headers.forEach((h, idx) => {
      if (h) values[h] = (r.cells[idx] ?? '').trim()
    })
    return { line: r.line, values }
  })
  return { headers, rows }
}

/**
 * A number from a cell: blank is `fallback`; "12,5" (decimal comma) is 12.5;
 * anything else unparseable is NaN.
 */
export function parseNumber(raw, fallback = 0) {
  const s = String(raw ?? '').trim().replace(/\s/g, '')
  if (s === '') return fallback
  const normalized = /^-?\d+,\d+$/.test(s) ? s.replace(',', '.') : s
  return /^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(normalized) ? Number(normalized) : NaN
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** The import kinds, in tab order. */
export const IMPORT_KINDS = ['daily', 'biweekly', 'stocking']

/** Most rows one import may hold (convex/lib/bulkImport MAX_IMPORT_ROWS). */
export const MAX_IMPORT_ROWS = 1000
/** Rows per import call (convex/lib/bulkImport IMPORT_CHUNK). */
export const IMPORT_CHUNK = 50
/** Rows per check call (convex/lib/bulkImport CHECK_CHUNK). */
export const CHECK_CHUNK = 100

/** Template and "Columns:" line per kind (Paper 53 shows the daily one). */
export const IMPORT_COLUMNS = {
  daily: ['date', 'cage', 'feed_kg', 'feed_type', 'mortality', 'do_mgl', 'temp_c'],
  biweekly: ['date', 'cage', 'abw_g', 'fish_count', 'total_weight_kg', 'batch_code'],
  stocking: ['date', 'cage', 'fish_count', 'abw_g', 'biomass_kg', 'batch_number', 'source'],
}

/** Columns a file must have, per kind. */
export const REQUIRED_COLUMNS = {
  daily: ['date', 'cage'],
  biweekly: ['date', 'cage', 'abw_g'],
  stocking: ['date', 'cage', 'fish_count', 'abw_g'],
}

/** Row field <- accepted header names (first is the template name; the rest are older names). */
const FIELD_ALIASES = {
  date: ['date'],
  cage: ['cage', 'cage_name', 'cage_code'],
  feed: ['feed_kg', 'feed_amount', 'feed'],
  feedType: ['feed_type'],
  feedPrice: ['feed_price'],
  mortality: ['mortality', 'dead'],
  doMgl: ['do_mgl', 'do', 'dissolved_oxygen'],
  tempC: ['temp_c', 'temperature_c', 'temp'],
  notes: ['notes'],
  batch: ['batch_code', 'batch_number', 'batch'],
  abw: ['abw_g', 'abw', 'average_body_weight', 'initial_abw'],
  fishCount: ['fish_count', 'total_fish_count'],
  totalWeight: ['total_weight_kg', 'total_weight'],
  biomass: ['biomass_kg', 'biomass', 'initial_biomass'],
  source: ['source', 'source_location'],
  species: ['species'],
}

const HEADER_TO_FIELD = Object.fromEntries(
  Object.entries(FIELD_ALIASES).flatMap(([field, names]) => names.map((n) => [n, field])),
)

/** Required template columns missing from the file's headers. */
export function missingColumns(kind, headers) {
  const fields = new Set((headers || []).map((h) => HEADER_TO_FIELD[h]).filter(Boolean))
  return (REQUIRED_COLUMNS[kind] || []).filter((col) => !fields.has(HEADER_TO_FIELD[col]))
}

/** Parsed rows -> the server's row shape: { line, date, cage, feed, … } with the cells as typed. */
export function toImportRows(rows) {
  return (rows || []).map(({ line, values }) => {
    const out = { line }
    for (const [header, value] of Object.entries(values || {})) {
      const field = HEADER_TO_FIELD[header]
      if (field && value !== '' && out[field] === undefined) out[field] = String(value).slice(0, 500)
    }
    return out
  })
}

/** Header-only CSV for a kind. */
export function templateCsv(kind) {
  return `${(IMPORT_COLUMNS[kind] || IMPORT_COLUMNS.daily).join(',')}\n`
}

/** "18 KB" style size. */
export function formatFileSize(bytes) {
  const n = Number(bytes) || 0
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Counts for the chips and the bottom bar: all / ok / warning / error, the
 * date span and the number of cages among rows that will be imported.
 */
export function summarizeCheck(results, rows) {
  const byLine = new Map((rows || []).map((r) => [r.line, r]))
  const counts = { all: 0, ok: 0, warning: 0, error: 0 }
  const cages = new Set()
  let from = null
  let to = null
  for (const r of results || []) {
    counts.all += 1
    counts[r.status] = (counts[r.status] || 0) + 1
    if (r.status === 'error') continue
    if (r.cageId) cages.add(r.cageId)
    const date = byLine.get(r.line)?.date
    if (isIsoDate(date)) {
      if (!from || date < from) from = date
      if (!to || date > to) to = date
    }
  }
  return { ...counts, ready: counts.ok + counts.warning, from, to, cages: cages.size }
}
