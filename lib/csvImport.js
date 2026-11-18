/**
 * CSV import (MOBILE-009): a real parser and the row rules shared by the bulk
 * daily and bi-weekly uploads.
 *
 * parseCsv handles RFC 4180 quoting (commas, quotes and line breaks inside
 * quoted fields), CRLF, a UTF-8 BOM, blank lines and semicolon-separated files
 * (Excel in French locales). Each row keeps its line number in the file so a
 * skipped row can be reported where the user can find it.
 *
 * The build* helpers apply the same rules as interactive entry and return
 * { records, skipped: [{ line, reason }] } instead of silently dropping rows.
 * Reasons are i18n keys (`csvImport.reason.*`) with params.
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

/** First non-empty value among column aliases. */
function pick(values, ...names) {
  for (const n of names) {
    const v = values[n]
    if (v != null && v !== '') return v
  }
  return ''
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

function byNameMap(list) {
  const map = new Map()
  for (const item of list || []) {
    const name = String(item?.name || '').trim().toLowerCase()
    if (name && !map.has(name)) map.set(name, item)
  }
  return map
}

const idOf = (x) => x?.id || x?._id

function checkDate(date, today) {
  if (!date) return { key: 'csvImport.reason.missingDate' }
  if (!isIsoDate(date)) return { key: 'csvImport.reason.badDate', params: { value: date } }
  if (today && date > today) return { key: 'csvImport.reason.futureDate', params: { value: date } }
  return null
}

/**
 * Daily rows -> createMany records. Rules (as interactive daily entry): known
 * cage; date YYYY-MM-DD not in the future; feed and price ≥ 0; mortality a
 * whole number ≥ 0; a feed type when feed > 0; one row per cage and date.
 */
export function buildDailyRecords(rows, { cages, feedTypes, today } = {}) {
  const cageByName = byNameMap(cages)
  const feedByName = byNameMap(feedTypes)
  const records = []
  const skipped = []
  const seen = new Set()
  for (const { line, values } of rows) {
    const skip = (key, params) => skipped.push({ line, reason: { key, params } })
    const cageName = pick(values, 'cage_name', 'cage')
    if (!cageName) {
      skip('csvImport.reason.missingCage')
      continue
    }
    const cage = cageByName.get(cageName.toLowerCase())
    if (!cage) {
      skip('csvImport.reason.unknownCage', { value: cageName })
      continue
    }
    const date = pick(values, 'date')
    const dateProblem = checkDate(date, today)
    if (dateProblem) {
      skipped.push({ line, reason: dateProblem })
      continue
    }
    const feedAmount = parseNumber(pick(values, 'feed_amount', 'feed_kg', 'feed'))
    if (!Number.isFinite(feedAmount) || feedAmount < 0) {
      skip('csvImport.reason.badNumber', { column: 'feed_amount' })
      continue
    }
    const mortality = parseNumber(pick(values, 'mortality', 'dead'))
    if (!Number.isInteger(mortality) || mortality < 0) {
      skip('csvImport.reason.badWholeNumber', { column: 'mortality' })
      continue
    }
    const feedName = pick(values, 'feed_type')
    const feedType = feedName ? feedByName.get(feedName.toLowerCase()) : null
    if (feedName && !feedType) {
      skip('csvImport.reason.unknownFeedType', { value: feedName })
      continue
    }
    if (feedAmount > 0 && !feedType) {
      skip('csvImport.reason.feedTypeRequired')
      continue
    }
    const feedPrice = parseNumber(
      pick(values, 'feed_price'),
      Number(feedType?.price_per_kg ?? feedType?.pricePerKg ?? 0) || 0,
    )
    if (!Number.isFinite(feedPrice) || feedPrice < 0) {
      skip('csvImport.reason.badNumber', { column: 'feed_price' })
      continue
    }
    const cageId = idOf(cage)
    const dupKey = `${cageId}|${date}`
    if (seen.has(dupKey)) {
      skip('csvImport.reason.duplicateRow', { value: `${cage.name} ${date}` })
      continue
    }
    seen.add(dupKey)
    const notes = pick(values, 'notes')
    records.push({
      cageId,
      date,
      feedAmount,
      feedTypeId: feedType ? idOf(feedType) : undefined,
      feedType: feedType ? feedType.name : undefined,
      feedPrice,
      feedCost: feedAmount * feedPrice,
      mortality,
      notes: notes || undefined,
      line,
    })
  }
  return { records, skipped }
}

/**
 * Bi-weekly rows -> createMany records. Rules (as interactive sampling):
 * known cage; valid date not in the future; average body weight > 0; fish
 * count a whole number ≥ 0; total weight ≥ 0 (computed from ABW × count when
 * blank); batch codes unique within the file.
 */
export function buildBiweeklyRecords(rows, { cages, today } = {}) {
  const cageByName = byNameMap(cages)
  const records = []
  const skipped = []
  const seen = new Set()
  for (const { line, values } of rows) {
    const skip = (key, params) => skipped.push({ line, reason: { key, params } })
    const cageName = pick(values, 'cage_name', 'cage')
    if (!cageName) {
      skip('csvImport.reason.missingCage')
      continue
    }
    const cage = cageByName.get(cageName.toLowerCase())
    if (!cage) {
      skip('csvImport.reason.unknownCage', { value: cageName })
      continue
    }
    const date = pick(values, 'date')
    const dateProblem = checkDate(date, today)
    if (dateProblem) {
      skipped.push({ line, reason: dateProblem })
      continue
    }
    const abw = parseNumber(pick(values, 'average_body_weight', 'abw'), NaN)
    if (!Number.isFinite(abw) || abw <= 0) {
      skip('csvImport.reason.badPositive', { column: 'average_body_weight' })
      continue
    }
    const fishCount = parseNumber(pick(values, 'total_fish_count', 'fish_count'))
    if (!Number.isInteger(fishCount) || fishCount < 0) {
      skip('csvImport.reason.badWholeNumber', { column: 'total_fish_count' })
      continue
    }
    const totalWeight = parseNumber(pick(values, 'total_weight'), (abw * fishCount) / 1000)
    if (!Number.isFinite(totalWeight) || totalWeight < 0) {
      skip('csvImport.reason.badNumber', { column: 'total_weight' })
      continue
    }
    const batchCode = pick(values, 'batch_code', 'batch') || `${cage.name}-${date}`
    if (seen.has(batchCode.toLowerCase())) {
      skip('csvImport.reason.duplicateRow', { value: batchCode })
      continue
    }
    seen.add(batchCode.toLowerCase())
    records.push({
      cageId: idOf(cage),
      date,
      batchCode,
      averageBodyWeight: abw,
      totalFishCount: fishCount,
      totalWeight,
      line,
    })
  }
  return { records, skipped }
}

/** Drop the report-only `line` before sending to the server. */
export function toServerRecords(records) {
  return records.map(({ line: _line, ...rest }) => rest)
}
