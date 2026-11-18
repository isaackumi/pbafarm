/**
 * Report builder (ANLY-001): datasets, dimensions, measures, date ranges and
 * the aggregation of loaded rows. Pure and import-free, so the browser uses
 * the same catalog (components/reports) and tests run without a database.
 *
 * Every dataset reads rollups or company-indexed tables (D-006); the loaders
 * live in convex/reportBuilder.ts and turn rows into `Fact`s:
 *
 *   production → batchStats (one row per cycle active in the period;
 *                 cycle-to-date figures, period dimension = stocking date)
 *   feed, mortality, harvest → unitDailyStats (one row per unit per day)
 *   sales     → sales (by_company_and_saleDate)
 *   inventory → inventoryItemStock + feedInventory (stock now; no period)
 */

export const DATASET_IDS = ['production', 'feed', 'mortality', 'harvest', 'sales', 'inventory'] as const
export type DatasetId = (typeof DATASET_IDS)[number]

export const DIMENSION_IDS = [
  'site',
  'cage',
  'species',
  'batch',
  'period',
  'customer',
  'payment_status',
  'item',
  'category',
] as const
export type DimensionId = (typeof DIMENSION_IDS)[number]

export const GRANULARITIES = ['day', 'week', 'month', 'quarter', 'year'] as const
export type Granularity = (typeof GRANULARITIES)[number]

export const CHART_TYPES = ['table', 'bar', 'line', 'pie'] as const
export type ChartType = (typeof CHART_TYPES)[number]

export const RANGE_PRESETS = [
  'last_7_days',
  'last_30_days',
  'last_90_days',
  'month_to_date',
  'last_month',
  'quarter_to_date',
  'year_to_date',
  'last_12_months',
  'custom',
] as const
export type RangePreset = (typeof RANGE_PRESETS)[number]

/** Display hint for a measure (formatting only). */
export type MeasureFormat = 'count' | 'kg' | 'money' | 'pct' | 'ratio' | 'quantity'

export type MeasureDef =
  | { id: string; label: string; format: MeasureFormat; kind: 'sum'; field: string }
  | { id: string; label: string; format: MeasureFormat; kind: 'count' }
  | {
      id: string
      label: string
      format: MeasureFormat
      kind: 'ratio'
      num: string
      den: string
      /** Multiplier of num/den (100 for percentages). */
      scale?: number
    }

export type DatasetDef = {
  id: DatasetId
  label: string
  /** Besides reports.view. */
  permission: 'production.view' | 'finance.view' | 'inventory.view'
  /** false: a snapshot of now (no date range, no period). */
  dated: boolean
  dimensions: DimensionId[]
  measures: MeasureDef[]
  defaults: { dimensions: DimensionId[]; measures: string[]; chart: ChartType; granularity?: Granularity }
}

const sum = (id: string, label: string, format: MeasureFormat, field = id): MeasureDef => ({
  id,
  label,
  format,
  kind: 'sum',
  field,
})

export const DATASETS: Record<DatasetId, DatasetDef> = {
  production: {
    id: 'production',
    label: 'Production per cage and cycle',
    permission: 'production.view',
    dated: true,
    dimensions: ['site', 'cage', 'species', 'batch', 'period'],
    measures: [
      { id: 'cycles', label: 'Cycles', format: 'count', kind: 'count' },
      sum('live_fish', 'Live fish', 'count'),
      sum('biomass_kg', 'Biomass (kg)', 'kg'),
      sum('fish_in', 'Fish stocked and moved in', 'count'),
      sum('feed_kg', 'Feed (kg)', 'kg'),
      sum('feed_cost', 'Feed cost', 'money'),
      sum('gain_kg', 'Weight gain (kg)', 'kg'),
      sum('harvested_kg', 'Harvested (kg)', 'kg'),
      sum('mortality', 'Deaths', 'count'),
      { id: 'efcr', label: 'eFCR', format: 'ratio', kind: 'ratio', num: 'feed_kg', den: 'gain_kg' },
      {
        id: 'survival_pct',
        label: 'Survival %',
        format: 'pct',
        kind: 'ratio',
        num: 'survivors',
        den: 'fish_in',
        scale: 100,
      },
      {
        id: 'mortality_pct',
        label: 'Mortality %',
        format: 'pct',
        kind: 'ratio',
        num: 'mortality',
        den: 'fish_in',
        scale: 100,
      },
    ],
    defaults: { dimensions: ['site'], measures: ['biomass_kg', 'feed_kg', 'efcr'], chart: 'bar' },
  },
  feed: {
    id: 'feed',
    label: 'Feed',
    permission: 'production.view',
    dated: true,
    dimensions: ['site', 'cage', 'species', 'batch', 'period'],
    measures: [sum('feed_kg', 'Feed (kg)', 'kg'), sum('feed_cost', 'Feed cost (list price)', 'money')],
    defaults: { dimensions: ['period'], measures: ['feed_kg'], chart: 'line', granularity: 'week' },
  },
  mortality: {
    id: 'mortality',
    label: 'Mortality',
    permission: 'production.view',
    dated: true,
    dimensions: ['site', 'cage', 'species', 'batch', 'period'],
    measures: [
      sum('mortality', 'Deaths', 'count'),
      sum('mortality_kg', 'Deaths (kg, estimated)', 'kg'),
      sum('unaccounted', 'Unaccounted fish', 'count'),
    ],
    defaults: { dimensions: ['period'], measures: ['mortality'], chart: 'bar', granularity: 'week' },
  },
  harvest: {
    id: 'harvest',
    label: 'Harvest',
    permission: 'production.view',
    dated: true,
    dimensions: ['site', 'cage', 'species', 'batch', 'period'],
    measures: [
      sum('harvested_count', 'Fish harvested', 'count'),
      sum('harvested_kg', 'Harvested (kg)', 'kg'),
      {
        id: 'avg_weight_g',
        label: 'Average weight (g)',
        format: 'ratio',
        kind: 'ratio',
        num: 'harvested_kg',
        den: 'harvested_count',
        scale: 1000,
      },
    ],
    defaults: { dimensions: ['site'], measures: ['harvested_kg'], chart: 'bar' },
  },
  sales: {
    id: 'sales',
    label: 'Sales',
    permission: 'finance.view',
    dated: true,
    dimensions: ['site', 'cage', 'customer', 'payment_status', 'period'],
    measures: [
      { id: 'sales', label: 'Sales', format: 'count', kind: 'count' },
      sum('weight_kg', 'Weight sold (kg)', 'kg'),
      sum('revenue', 'Revenue', 'money'),
      sum('amount_paid', 'Paid', 'money'),
      sum('outstanding', 'Outstanding', 'money'),
      { id: 'avg_price_kg', label: 'Average price per kg', format: 'money', kind: 'ratio', num: 'revenue', den: 'weight_kg' },
    ],
    defaults: { dimensions: ['period'], measures: ['revenue'], chart: 'bar', granularity: 'month' },
  },
  inventory: {
    id: 'inventory',
    label: 'Inventory on hand',
    permission: 'inventory.view',
    dated: false,
    dimensions: ['site', 'item', 'category'],
    measures: [sum('quantity', 'Quantity on hand', 'quantity'), sum('stock_value', 'Stock value', 'money')],
    defaults: { dimensions: ['category'], measures: ['stock_value'], chart: 'bar' },
  },
}

export const DIMENSION_LABELS: Record<DimensionId, string> = {
  site: 'Site',
  cage: 'Unit',
  species: 'Species',
  batch: 'Batch',
  period: 'Period',
  customer: 'Customer',
  payment_status: 'Payment status',
  item: 'Item',
  category: 'Category',
}

/** Dimensions offered as filters (their values come from reportBuilder.filterOptions). */
export const FILTER_DIMENSIONS: DimensionId[] = ['site', 'cage', 'species', 'payment_status', 'category']

export const LIMITS = {
  dimensions: 3,
  measures: 8,
  filters: 6,
  filterValues: 100,
  /** Source rows read per report (take(n + 1) flags truncation). */
  sourceRows: 10_000,
  /** Grouped rows returned. */
  resultRows: 1000,
  /** Longest custom range, in days. */
  rangeDays: 731,
  nameLength: 120,
  descriptionLength: 500,
} as const

export type ReportFilter = { dimension: DimensionId; values: string[] }
export type ReportRange = { preset: RangePreset; from?: string; to?: string }

export type ReportDefinition = {
  dataset: DatasetId
  dimensions: DimensionId[]
  granularity?: Granularity
  measures: string[]
  filters: ReportFilter[]
  range: ReportRange
  chart: { type: ChartType; measure?: string }
  sort?: { by: string; dir: 'asc' | 'desc' }
  limit?: number
}

export function defaultDefinition(dataset: DatasetId = 'production'): ReportDefinition {
  const d = DATASETS[dataset]
  return {
    dataset,
    dimensions: [...d.defaults.dimensions],
    granularity: d.defaults.granularity ?? (d.defaults.dimensions.includes('period') ? 'month' : undefined),
    measures: [...d.defaults.measures],
    filters: [],
    range: { preset: 'last_30_days' },
    chart: { type: d.defaults.chart },
  }
}

export function measureDef(dataset: DatasetId, id: string): MeasureDef | undefined {
  return DATASETS[dataset]?.measures.find((m) => m.id === id)
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isDate(s: unknown): s is string {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

function shiftDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`)
  const b = Date.parse(`${to}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

/** Why a definition is invalid, or null. Messages are shown to the user. */
export function checkDefinition(def: ReportDefinition): string | null {
  const ds = DATASETS[def.dataset]
  if (!ds) return 'Unknown dataset'
  if (!def.measures.length) return 'Choose at least one measure'
  if (def.measures.length > LIMITS.measures) return `Choose at most ${LIMITS.measures} measures`
  if (def.dimensions.length > LIMITS.dimensions) return `Group by at most ${LIMITS.dimensions} dimensions`
  if (new Set(def.dimensions).size !== def.dimensions.length) return 'A dimension is chosen twice'
  if (new Set(def.measures).size !== def.measures.length) return 'A measure is chosen twice'
  for (const dim of def.dimensions) {
    if (!ds.dimensions.includes(dim)) return `${DIMENSION_LABELS[dim] ?? dim} is not available for ${ds.label}`
  }
  for (const m of def.measures) if (!measureDef(def.dataset, m)) return `Unknown measure: ${m}`
  if (def.dimensions.includes('period') && !def.granularity) return 'Choose a period size'
  if (def.filters.length > LIMITS.filters) return `Use at most ${LIMITS.filters} filters`
  for (const f of def.filters) {
    if (!ds.dimensions.includes(f.dimension)) return `Cannot filter ${ds.label} by ${f.dimension}`
    if (f.dimension === 'period') return 'Filter periods with the date range'
    if (f.values.length > LIMITS.filterValues) return `A filter can list at most ${LIMITS.filterValues} values`
  }
  if (def.range.preset === 'custom') {
    if (!isDate(def.range.from) || !isDate(def.range.to)) return 'Enter a start and end date'
    if (def.range.from > def.range.to) return 'The start date is after the end date'
    if (daysBetween(def.range.from, def.range.to) > LIMITS.rangeDays) {
      return `The date range can be at most ${LIMITS.rangeDays} days`
    }
  }
  const columns = new Set<string>([...def.dimensions, ...def.measures])
  if (def.sort && !columns.has(def.sort.by)) return 'Sort by a chosen dimension or measure'
  if (def.chart.measure && !def.measures.includes(def.chart.measure)) return 'Chart a chosen measure'
  if (def.limit !== undefined && (!Number.isInteger(def.limit) || def.limit < 1 || def.limit > LIMITS.resultRows)) {
    return `Row limit must be between 1 and ${LIMITS.resultRows}`
  }
  return null
}

/** Inclusive [from, to] business dates of a range, relative to `today`. */
export function resolveRange(range: ReportRange, today: string): { from: string; to: string } {
  const [y, m] = today.split('-').map(Number)
  const pad = (n: number) => String(n).padStart(2, '0')
  const monthStart = (yy: number, mm: number) => {
    const d = new Date(Date.UTC(yy, mm - 1, 1))
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-01`
  }
  switch (range.preset) {
    case 'last_7_days':
      return { from: shiftDays(today, -6), to: today }
    case 'last_30_days':
      return { from: shiftDays(today, -29), to: today }
    case 'last_90_days':
      return { from: shiftDays(today, -89), to: today }
    case 'month_to_date':
      return { from: monthStart(y, m), to: today }
    case 'last_month': {
      const from = monthStart(y, m - 1)
      return { from, to: shiftDays(monthStart(y, m), -1) }
    }
    case 'quarter_to_date':
      return { from: monthStart(y, Math.floor((m - 1) / 3) * 3 + 1), to: today }
    case 'year_to_date':
      return { from: `${y}-01-01`, to: today }
    case 'last_12_months':
      return { from: shiftDays(today, -364), to: today }
    case 'custom':
      return { from: range.from ?? today, to: range.to ?? today }
  }
}

/** The bucket a date falls in. Weeks start on Monday and are keyed by that date. */
export function periodKey(date: string, g: Granularity): string {
  switch (g) {
    case 'day':
      return date
    case 'week': {
      const [y, m, d] = date.split('-').map(Number)
      const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
      return shiftDays(date, -((weekday + 6) % 7))
    }
    case 'month':
      return date.slice(0, 7)
    case 'quarter':
      return `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`
    case 'year':
      return date.slice(0, 4)
  }
}

/** One loaded source row: dimension keys (ids or values) and additive fields. */
export type Fact = {
  dims: Partial<Record<DimensionId, string>>
  date?: string
  values: Record<string, number>
}

export type AggregatedRow = {
  keys: Partial<Record<DimensionId, string>>
  values: Record<string, number | null>
}

const NONE = ''

export function applyFilters(facts: Fact[], filters: ReportFilter[]): Fact[] {
  const active = filters.filter((f) => f.values.length)
  if (!active.length) return facts
  const sets = active.map((f) => ({ dim: f.dimension, values: new Set(f.values) }))
  return facts.filter((fact) => sets.every((s) => s.values.has(fact.dims[s.dim] ?? NONE)))
}

/**
 * Group facts by the chosen dimensions, add up fields, then compute each
 * measure from the group's sums (ratios are ratios of sums, never averages
 * of ratios). Sorted and capped at the definition's limit / LIMITS.resultRows.
 */
export function aggregate(
  facts: Fact[],
  def: ReportDefinition,
): { rows: AggregatedRow[]; truncated: boolean } {
  const measures = def.measures.map((id) => measureDef(def.dataset, id)).filter((m): m is MeasureDef => !!m)
  const groups = new Map<string, { keys: Partial<Record<DimensionId, string>>; sums: Record<string, number>; count: number }>()
  for (const fact of applyFilters(facts, def.filters)) {
    const keys: Partial<Record<DimensionId, string>> = {}
    for (const dim of def.dimensions) {
      keys[dim] =
        dim === 'period' ? (fact.date ? periodKey(fact.date, def.granularity ?? 'month') : NONE) : fact.dims[dim] ?? NONE
    }
    const id = JSON.stringify(def.dimensions.map((d) => keys[d]))
    let g = groups.get(id)
    if (!g) {
      g = { keys, sums: {}, count: 0 }
      groups.set(id, g)
    }
    g.count += 1
    for (const [field, value] of Object.entries(fact.values)) {
      if (Number.isFinite(value)) g.sums[field] = (g.sums[field] ?? 0) + value
    }
  }
  const rows: AggregatedRow[] = [...groups.values()].map((g) => {
    const values: Record<string, number | null> = {}
    for (const m of measures) {
      if (m.kind === 'count') values[m.id] = g.count
      else if (m.kind === 'sum') values[m.id] = round(g.sums[m.field] ?? 0)
      else {
        const den = g.sums[m.den] ?? 0
        values[m.id] = den > 0 ? round(((g.sums[m.num] ?? 0) / den) * (m.scale ?? 1)) : null
      }
    }
    return { keys: g.keys, values }
  })
  sortRows(rows, def)
  const cap = Math.min(def.limit ?? LIMITS.resultRows, LIMITS.resultRows)
  return { rows: rows.slice(0, cap), truncated: rows.length > cap }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

function sortRows(rows: AggregatedRow[], def: ReportDefinition) {
  const by = def.sort?.by ?? (def.dimensions.includes('period') ? 'period' : def.measures[0])
  const dir = def.sort?.dir ?? (by === 'period' || (def.dimensions as string[]).includes(by) ? 'asc' : 'desc')
  const isDim = (def.dimensions as string[]).includes(by)
  const sign = dir === 'asc' ? 1 : -1
  rows.sort((a, b) => {
    if (isDim) {
      const x = a.keys[by as DimensionId] ?? ''
      const y = b.keys[by as DimensionId] ?? ''
      return sign * x.localeCompare(y)
    }
    const x = a.values[by]
    const y = b.values[by]
    if (x === y) return 0
    if (x === null || x === undefined) return 1
    if (y === null || y === undefined) return -1
    return sign * (x - y)
  })
}

export type ReportColumn = {
  id: string
  label: string
  kind: 'dimension' | 'measure'
  format?: MeasureFormat
}

export function reportColumns(def: ReportDefinition): ReportColumn[] {
  return [
    ...def.dimensions.map((id) => ({ id, label: DIMENSION_LABELS[id], kind: 'dimension' as const })),
    ...def.measures.map((id) => {
      const m = measureDef(def.dataset, id)
      return { id, label: m?.label ?? id, kind: 'measure' as const, format: m?.format }
    }),
  ]
}

/** RFC 4180 CSV with a header row of column labels. */
export function reportCsv(columns: ReportColumn[], rows: Array<Record<string, unknown>>): string {
  const cell = (value: unknown) => {
    if (value === undefined || value === null) return ''
    let text = String(value)
    // Spreadsheet formula injection: a cell starting with = + - @ is text.
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const lines = [columns.map((c) => cell(c.label)).join(',')]
  for (const row of rows) lines.push(columns.map((c) => cell(row[c.id])).join(','))
  return lines.join('\r\n') + '\r\n'
}

/** Label of a period key: weeks read "Week of 2026-11-16", others as keyed. */
export function periodLabel(key: string, g: Granularity | undefined): string {
  if (!key) return '—'
  return g === 'week' ? `Week of ${key}` : key
}
