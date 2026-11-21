/**
 * Bulk import row rules (Paper 53). Pure: the caller loads the site's cages,
 * feed types, cage history and existing records, and these functions decide
 * each row's status. Errors are skipped on import; warnings are imported.
 *
 * A reason is an i18n key under `csvImport.reason.*` with params, plus the
 * cell it points at so the check table can colour it.
 */
import type { StockingProblem } from './farmRules'

export type ImportKind = 'daily' | 'biweekly' | 'stocking'

/** Most rows one import may hold; the check table pages through them. */
export const MAX_IMPORT_ROWS = 1000
/** Rows per import mutation call. */
export const IMPORT_CHUNK = 50
/** Days of cage history the mortality average looks back over. */
export const MORTALITY_LOOKBACK_DAYS = 30
/** Mortality this many times the cage's daily average is a warning. */
export const MORTALITY_OUTLIER_RATIO = 3
/** History rows needed before an average means anything. */
export const MORTALITY_MIN_HISTORY = 3

/** One CSV row after header aliases are resolved (all cells as typed). */
export type ImportRowInput = {
  line: number
  date?: string
  cage?: string
  feed?: string
  feedType?: string
  feedPrice?: string
  mortality?: string
  doMgl?: string
  tempC?: string
  notes?: string
  batch?: string
  abw?: string
  fishCount?: string
  totalWeight?: string
  biomass?: string
  source?: string
  species?: string
}

export type ImportField = 'date' | 'cage' | 'feed' | 'feedType' | 'feedPrice' | 'mortality' | 'do' | 'temp' | 'batch' | 'abw' | 'fishCount' | 'totalWeight' | 'biomass'

export type RowReason = { code: string; params?: Record<string, string | number> }

export type DailyRecordOut = {
  cageId: string
  date: string
  feedAmount: number
  feedTypeId?: string
  feedType?: string
  feedPrice: number
  feedCost: number
  mortality: number
  dissolvedOxygen?: number
  temperatureC?: number
  notes?: string
}
export type BiweeklyRecordOut = {
  cageId: string
  date: string
  batchCode: string
  averageBodyWeight: number
  totalFishCount: number
  totalWeight: number
}
export type StockingRecordOut = {
  cageId: string
  stockingDate: string
  fishCount: number
  initialAbw: number
  initialBiomass: number
  batchNumber?: string
  sourceLocation?: string
  species?: string
}

export type RowResult<R> = {
  line: number
  status: 'ok' | 'warning' | 'error'
  field?: ImportField
  reason?: RowReason
  record?: R
}

export type CageLite = { id: string; name: string; status?: string; capacity?: number | null; raw?: unknown }
export type FeedTypeLite = { id: string; name: string; pricePerKg?: number; currentStock?: number }

/** A number from a cell: blank is `fallback`; "12,5" (decimal comma) is 12.5; junk is NaN. */
export function parseNumber(raw: string | undefined | null, fallback = 0): number {
  const s = String(raw ?? '').trim().replace(/\s/g, '')
  if (s === '') return fallback
  const normalized = /^-?\d+,\d+$/.test(s) ? s.replace(',', '.') : s
  return /^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(normalized) ? Number(normalized) : NaN
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(s: string | undefined | null): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false
  const d = new Date(`${s}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const norm = (s: string | undefined) => String(s ?? '').trim().toLowerCase()

export function byName<T extends { name: string }>(list: T[]): Map<string, T> {
  const map = new Map<string, T>()
  for (const item of list) {
    const key = norm(item.name)
    if (key && !map.has(key)) map.set(key, item)
  }
  return map
}

/** Cage ids and the date span the rows name: what the caller loads history for. */
export function rowSpan(rows: ImportRowInput[], cages: CageLite[]) {
  const cageByName = byName(cages)
  const cageIds = new Set<string>()
  let from: string | null = null
  let to: string | null = null
  for (const r of rows) {
    const cage = cageByName.get(norm(r.cage))
    if (cage) cageIds.add(cage.id)
    const d = String(r.date ?? '').trim()
    if (isIsoDate(d)) {
      if (!from || d < from) from = d
      if (!to || d > to) to = d
    }
  }
  return { cageIds: [...cageIds], from, to }
}

type Ctx = {
  cages: CageLite[]
  today: string
  /** The site name for "Cage X not found at {site}"; null when importing across sites. */
  siteName: string | null
}

const err = <R>(line: number, field: ImportField | undefined, code: string, params?: RowReason['params']): RowResult<R> => ({
  line,
  status: 'error',
  field,
  reason: { code, params },
})

function cageAndDate<R>(row: ImportRowInput, ctx: Ctx, cageByName: Map<string, CageLite>) {
  const name = String(row.cage ?? '').trim()
  if (!name) return { fail: err<R>(row.line, 'cage', 'missingCage') }
  const cage = cageByName.get(name.toLowerCase())
  if (!cage) {
    return {
      fail: ctx.siteName
        ? err<R>(row.line, 'cage', 'cageNotAtSite', { value: name, site: ctx.siteName })
        : err<R>(row.line, 'cage', 'unknownCage', { value: name }),
    }
  }
  const date = String(row.date ?? '').trim()
  if (!date) return { fail: err<R>(row.line, 'date', 'missingDate') }
  if (!isIsoDate(date)) return { fail: err<R>(row.line, 'date', 'invalidDate', { value: date }) }
  if (date > ctx.today) return { fail: err<R>(row.line, 'date', 'futureDate', { value: date }) }
  return { cage, date }
}

export type DailyCtx = Ctx & {
  feedTypes: FeedTypeLite[]
  /** Daily records already on file per cage: [{ date, mortality }]. */
  history: Map<string, { date: string; mortality: number }[]>
  /** DO alert floor (mg/L) per cage id. */
  doMin: (cageId: string) => number | undefined
  /** Kg in the cage's feed bin, fed before store stock. */
  binKg?: (cageId: string, feedTypeId: string) => number
  allowNegativeStock?: boolean
}

/** Mean daily mortality for the cage over the lookback before `date`, or null with too little history. */
export function mortalityAverage(history: { date: string; mortality: number }[] | undefined, date: string): number | null {
  if (!history?.length) return null
  const from = addDaysIso(date, -MORTALITY_LOOKBACK_DAYS)
  const window = history.filter((h) => h.date >= from && h.date < date)
  if (window.length < MORTALITY_MIN_HISTORY) return null
  const avg = window.reduce((s, h) => s + (Number(h.mortality) || 0), 0) / window.length
  return avg > 0 ? avg : null
}

/**
 * Daily rows. Errors: cage not at the site, bad or future date, feed and
 * price ≥ 0, mortality a whole number ≥ 0, a known feed type (required when
 * feed > 0), DO and temperature numbers, one row per cage and date, a record
 * already on file, and not more feed than the store holds. Warnings:
 * mortality ≥ 3× the cage average, DO under the alert floor.
 */
export function checkDailyRows(rows: ImportRowInput[], ctx: DailyCtx): RowResult<DailyRecordOut>[] {
  const cageByName = byName(ctx.cages)
  const feedByName = byName(ctx.feedTypes)
  const seen = new Set<string>()
  const stockLeft = new Map(ctx.feedTypes.map((f) => [f.id, Number(f.currentStock ?? 0)]))
  const binLeft = new Map<string, number>()
  return rows.map((row) => {
    const base = cageAndDate<DailyRecordOut>(row, ctx, cageByName)
    if ('fail' in base) return base.fail!
    const { cage, date } = base
    const feedAmount = parseNumber(row.feed)
    if (!Number.isFinite(feedAmount) || feedAmount < 0) return err(row.line, 'feed', 'badNumber', { column: 'feed_kg' })
    const mortality = parseNumber(row.mortality)
    if (!Number.isInteger(mortality) || mortality < 0) return err(row.line, 'mortality', 'badWholeNumber', { column: 'mortality' })
    const feedName = String(row.feedType ?? '').trim()
    const feedType = feedName ? feedByName.get(feedName.toLowerCase()) : undefined
    if (feedName && !feedType) return err(row.line, 'feedType', 'unknownFeedType', { value: feedName })
    if (feedAmount > 0 && !feedType) return err(row.line, 'feedType', 'feedTypeRequired')
    const feedPrice = parseNumber(row.feedPrice, Number(feedType?.pricePerKg ?? 0) || 0)
    if (!Number.isFinite(feedPrice) || feedPrice < 0) return err(row.line, 'feedPrice', 'badNumber', { column: 'feed_price' })
    const doRaw = String(row.doMgl ?? '').trim()
    const dissolvedOxygen = doRaw ? parseNumber(doRaw, NaN) : undefined
    if (dissolvedOxygen !== undefined && (!Number.isFinite(dissolvedOxygen) || dissolvedOxygen < 0 || dissolvedOxygen > 30)) {
      return err(row.line, 'do', 'badRange', { column: 'do_mgl', min: 0, max: 30 })
    }
    const tempRaw = String(row.tempC ?? '').trim()
    const temperatureC = tempRaw ? parseNumber(tempRaw, NaN) : undefined
    if (temperatureC !== undefined && (!Number.isFinite(temperatureC) || temperatureC < 0 || temperatureC > 45)) {
      return err(row.line, 'temp', 'badRange', { column: 'temp_c', min: 0, max: 45 })
    }
    const key = `${cage.id}|${date}`
    if (seen.has(key)) return err(row.line, 'date', 'duplicateRow', { value: `${cage.name} ${date}` })
    const history = ctx.history.get(cage.id)
    if (history?.some((h) => h.date === date)) {
      return err(row.line, 'date', 'alreadyRecorded', { cage: cage.name, date })
    }
    if (feedType && feedAmount > 0 && !ctx.allowNegativeStock) {
      const binKey = `${cage.id}|${feedType.id}`
      const bin = binLeft.has(binKey) ? binLeft.get(binKey)! : (ctx.binKg?.(cage.id, feedType.id) ?? 0)
      const fromBin = Math.min(bin, feedAmount)
      const fromStore = feedAmount - fromBin
      const store = stockLeft.get(feedType.id) ?? 0
      if (fromStore > store + 1e-6) {
        return err(row.line, 'feed', 'notEnoughStock', { feed: feedType.name, have: Math.max(0, Math.round(store * 10) / 10) })
      }
      binLeft.set(binKey, bin - fromBin)
      stockLeft.set(feedType.id, store - fromStore)
    }
    seen.add(key)
    const record: DailyRecordOut = {
      cageId: cage.id,
      date,
      feedAmount,
      feedTypeId: feedType?.id,
      feedType: feedType?.name,
      feedPrice,
      feedCost: feedAmount * feedPrice,
      mortality,
      ...(dissolvedOxygen !== undefined ? { dissolvedOxygen } : {}),
      ...(temperatureC !== undefined ? { temperatureC } : {}),
      ...(row.notes?.trim() ? { notes: row.notes.trim() } : {}),
    }
    const avg = mortalityAverage(history, date)
    if (avg !== null && mortality >= avg * MORTALITY_OUTLIER_RATIO) {
      return { line: row.line, status: 'warning', field: 'mortality', reason: { code: 'mortalityOutlier', params: { times: Math.round(mortality / avg) } }, record }
    }
    const floor = ctx.doMin(cage.id)
    if (dissolvedOxygen !== undefined && floor !== undefined && dissolvedOxygen < floor) {
      return { line: row.line, status: 'warning', field: 'do', reason: { code: 'lowDo', params: { min: floor } }, record }
    }
    return { line: row.line, status: 'ok', record }
  })
}

export type BiweeklyCtx = Ctx & {
  /** Batch codes (lower-cased) already used in the organization. */
  takenBatchCodes: Set<string>
}

/**
 * Bi-weekly rows. Errors: cage not at the site, bad or future date, ABW > 0,
 * fish count a whole number ≥ 0, total weight ≥ 0 (ABW × count when blank),
 * batch code unique in the file and the organization.
 */
export function checkBiweeklyRows(rows: ImportRowInput[], ctx: BiweeklyCtx): RowResult<BiweeklyRecordOut>[] {
  const cageByName = byName(ctx.cages)
  const seen = new Set<string>()
  return rows.map((row) => {
    const base = cageAndDate<BiweeklyRecordOut>(row, ctx, cageByName)
    if ('fail' in base) return base.fail!
    const { cage, date } = base
    const abw = parseNumber(row.abw, NaN)
    if (!Number.isFinite(abw) || abw <= 0) return err(row.line, 'abw', 'badPositive', { column: 'abw_g' })
    const fish = parseNumber(row.fishCount)
    if (!Number.isInteger(fish) || fish < 0) return err(row.line, 'fishCount', 'badWholeNumber', { column: 'fish_count' })
    const totalWeight = parseNumber(row.totalWeight, (abw * fish) / 1000)
    if (!Number.isFinite(totalWeight) || totalWeight < 0) return err(row.line, 'totalWeight', 'badNumber', { column: 'total_weight_kg' })
    const batchCode = String(row.batch ?? '').trim() || `${cage.name}-${date}`
    const key = batchCode.toLowerCase()
    if (seen.has(key)) return err(row.line, 'batch', 'duplicateRow', { value: batchCode })
    if (ctx.takenBatchCodes.has(key)) return err(row.line, 'batch', 'batchTaken', { value: batchCode })
    seen.add(key)
    return {
      line: row.line,
      status: 'ok',
      record: { cageId: cage.id, date, batchCode, averageBodyWeight: abw, totalFishCount: fish, totalWeight },
    }
  })
}

export type StockingCtx = Ctx & {
  /** Stocking dates already on file per cage. */
  stockedOn: Map<string, Set<string>>
  /** The farm's stocking rules for a cage (status, ABW range, capacity, density). */
  problem: (cage: CageLite, fishCount: number, abw: number) => StockingProblem | null
}

/**
 * Stocking rows, under the same rules as a stocking request. Errors: cage
 * not at the site, bad or future date, fish a whole number > 0, ABW > 0,
 * biomass ≥ 0 (fish × ABW when blank), one row per cage, the cage already
 * stocked that day, and the farm's stocking rules.
 */
export function checkStockingRows(rows: ImportRowInput[], ctx: StockingCtx): RowResult<StockingRecordOut>[] {
  const cageByName = byName(ctx.cages)
  const seen = new Set<string>()
  return rows.map((row) => {
    const base = cageAndDate<StockingRecordOut>(row, ctx, cageByName)
    if ('fail' in base) return base.fail!
    const { cage, date } = base
    const fish = parseNumber(row.fishCount, NaN)
    if (!Number.isInteger(fish) || fish <= 0) return err(row.line, 'fishCount', 'badPositiveWhole', { column: 'fish_count' })
    const abw = parseNumber(row.abw, NaN)
    if (!Number.isFinite(abw) || abw <= 0) return err(row.line, 'abw', 'badPositive', { column: 'abw_g' })
    const biomass = parseNumber(row.biomass, (abw * fish) / 1000)
    if (!Number.isFinite(biomass) || biomass < 0) return err(row.line, 'biomass', 'badNumber', { column: 'biomass_kg' })
    if (seen.has(cage.id)) return err(row.line, 'cage', 'duplicateRow', { value: cage.name })
    if (ctx.stockedOn.get(cage.id)?.has(date)) return err(row.line, 'date', 'alreadyRecorded', { cage: cage.name, date })
    const problem = ctx.problem(cage, fish, abw)
    if (problem) {
      const field: ImportField = problem.code === 'stockAbwRange' ? 'abw' : problem.code === 'stockStatus' ? 'cage' : 'fishCount'
      return err(row.line, field, problem.code, problem.params)
    }
    seen.add(cage.id)
    return {
      line: row.line,
      status: 'ok',
      record: {
        cageId: cage.id,
        stockingDate: date,
        fishCount: fish,
        initialAbw: abw,
        initialBiomass: biomass,
        ...(row.batch?.trim() ? { batchNumber: row.batch.trim() } : {}),
        ...(row.source?.trim() ? { sourceLocation: row.source.trim() } : {}),
        ...(row.species?.trim() ? { species: row.species.trim() } : {}),
      },
    }
  })
}
