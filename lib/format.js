/**
 * Formatting for new code (I18N-001, D-012): money, numbers, dates in a time
 * zone, units of measure and unit-type labels. Storage stays metric and dates
 * stay `YYYY-MM-DD` local business days; these helpers only present them.
 *
 * The active zone is the header site's time zone, else the organization's,
 * else the browser's. LocationContext sets it with setActiveZone(), so code
 * outside React (form defaults) can call localToday().
 */

let activeZone = null
let activeLocale = null
let activeUnitSystem = 'metric'
let activeCurrency = 'GHS'

/** Called by LocationContext when the site or organization changes. */
export function setActiveZone(zone) {
  activeZone = zone || null
}

/**
 * BCP 47 tag used for numbers, money and dates (I18N-002). Set by the
 * I18nProvider from the user's language and the organization's region;
 * null = the browser's default, which is what every helper did before.
 */
export function setActiveLocale(locale) {
  activeLocale = locale || null
}

export function getActiveLocale() {
  return activeLocale || undefined
}

/** The organization's unit system ('metric' | 'imperial'); storage stays metric. */
export function setActiveUnitSystem(system) {
  activeUnitSystem = system === 'imperial' ? 'imperial' : 'metric'
}

export function getActiveUnitSystem() {
  return activeUnitSystem
}

/** The organization's currency (ISO 4217), used when a caller does not pass one. */
export function setActiveCurrency(code) {
  activeCurrency = code || 'GHS'
}

export function getActiveCurrency() {
  return activeCurrency
}

export function getActiveZone() {
  if (activeZone) return activeZone
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function validZone(zone) {
  if (!zone) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/** The calendar date (`YYYY-MM-DD`) at `now` in `zone`. */
export function todayIn(zone, now = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: validZone(zone) ? zone : 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now))
}

/** Today's business date for the active site: use for form defaults. */
export function localToday(now = Date.now()) {
  return todayIn(getActiveZone(), now)
}

/** `YYYY-MM-DD` shifted by `days`. */
export function addDays(date, days) {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Whole days between two business dates; never negative (same rule as the server). */
export function daysBetween(fromIso, toIso) {
  const ms = new Date(`${toIso}T12:00:00Z`).getTime() - new Date(`${fromIso}T12:00:00Z`).getTime()
  if (!Number.isFinite(ms)) return 0
  return Math.max(0, Math.round(ms / 86_400_000))
}

export function formatNumber(value, { locale = getActiveLocale(), decimals = 0 } = {}) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n)
}

/** Money in the organization's currency (or `currency`), in the active locale. */
export function formatMoney(amount, { currency = getActiveCurrency(), locale = getActiveLocale(), decimals = 2 } = {}) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '—'
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(n)
  } catch {
    return `${currency} ${n.toFixed(decimals)}`
  }
}

/** A business date (`YYYY-MM-DD`) for display, e.g. "18 Nov 2026". */
export function formatDate(isoDate, { locale = getActiveLocale() } = {}) {
  if (!isoDate) return '—'
  const d = new Date(`${isoDate}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return String(isoDate)
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d)
}

/** A timestamp shown in a zone, e.g. "18 Nov 2026, 23:30". */
export function formatDateTime(ms, { zone = getActiveZone(), locale = getActiveLocale() } = {}) {
  if (ms == null) return '—'
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: validZone(zone) ? zone : 'UTC',
  }).format(new Date(ms))
}

const KG_PER_LB = 0.45359237
const G_PER_OZ = 28.349523125
const M_PER_FT = 0.3048
const CM_PER_IN = 2.54
const M3_PER_FT3 = 0.028316846592
const M2_PER_FT2 = 0.09290304
const L_PER_GAL = 3.785411784 // US gallon

/**
 * Quantity kinds. Each is stored in its metric unit; `toDisplay` converts a
 * metric value for an imperial organization and `toMetric` converts back.
 */
const QUANTITY_KINDS = {
  mass: { metric: 'kg', imperial: 'lb', toDisplay: (n) => n / KG_PER_LB, toMetric: (n) => n * KG_PER_LB },
  weight: { metric: 'kg', imperial: 'lb', toDisplay: (n) => n / KG_PER_LB, toMetric: (n) => n * KG_PER_LB },
  smallMass: { metric: 'g', imperial: 'oz', toDisplay: (n) => n / G_PER_OZ, toMetric: (n) => n * G_PER_OZ },
  length: { metric: 'm', imperial: 'ft', toDisplay: (n) => n / M_PER_FT, toMetric: (n) => n * M_PER_FT },
  shortLength: { metric: 'cm', imperial: 'in', toDisplay: (n) => n / CM_PER_IN, toMetric: (n) => n * CM_PER_IN },
  area: { metric: 'm²', imperial: 'ft²', toDisplay: (n) => n / M2_PER_FT2, toMetric: (n) => n * M2_PER_FT2 },
  volume: { metric: 'm³', imperial: 'ft³', toDisplay: (n) => n / M3_PER_FT3, toMetric: (n) => n * M3_PER_FT3 },
  liquid: { metric: 'L', imperial: 'gal', toDisplay: (n) => n / L_PER_GAL, toMetric: (n) => n * L_PER_GAL },
  temperature: {
    metric: '°C',
    imperial: '°F',
    toDisplay: (n) => (n * 9) / 5 + 32,
    toMetric: (n) => ((n - 32) * 5) / 9,
  },
}

export const QUANTITY_KIND_NAMES = Object.keys(QUANTITY_KINDS)

/** The display unit for a kind, e.g. unitSymbol('mass', 'imperial') → 'lb'. */
export function unitSymbol(kind, unitSystem = getActiveUnitSystem()) {
  const k = QUANTITY_KINDS[kind]
  if (!k) return ''
  return unitSystem === 'imperial' ? k.imperial : k.metric
}

/** A metric value converted to the display unit (number, unrounded). */
export function fromMetric(value, kind, unitSystem = getActiveUnitSystem()) {
  const n = Number(value)
  const k = QUANTITY_KINDS[kind]
  if (!Number.isFinite(n) || !k || unitSystem !== 'imperial') return n
  return k.toDisplay(n)
}

/** Display a metric quantity in the organization's unit system. */
export function formatQuantity(
  value,
  kind,
  { unitSystem = getActiveUnitSystem(), locale = getActiveLocale(), decimals = 1 } = {},
) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const shown = fromMetric(n, kind, unitSystem)
  const unit = unitSymbol(kind, unitSystem)
  const sep = kind === 'temperature' ? '' : ' '
  return `${formatNumber(shown, { locale, decimals })}${unit ? sep + unit : ''}`.trim()
}

/** Convert a value typed in the display unit back to metric before saving. */
export function toMetric(value, kind, unitSystem = getActiveUnitSystem()) {
  const n = Number(value)
  const k = QUANTITY_KINDS[kind]
  if (!Number.isFinite(n) || !k || unitSystem !== 'imperial') return n
  return k.toMetric(n)
}

export const UNIT_TYPES = [
  { value: 'cage', label: 'Cage', plural: 'Cages', measure: 'volume' },
  { value: 'pond', label: 'Pond', plural: 'Ponds', measure: 'area' },
  { value: 'tank', label: 'Tank', plural: 'Tanks', measure: 'volume' },
  { value: 'raceway', label: 'Raceway', plural: 'Raceways', measure: 'volume' },
  { value: 'hatchery_tank', label: 'Hatchery tank', plural: 'Hatchery tanks', measure: 'volume' },
  { value: 'incubator', label: 'Incubator', plural: 'Incubators', measure: 'volume' },
  { value: 'hapa', label: 'Hapa', plural: 'Hapas', measure: 'volume' },
]

/** "Pond" for a pond, "Cage" for anything without a type. */
export function unitLabel(unitOrType, { plural = false } = {}) {
  const type =
    typeof unitOrType === 'string'
      ? unitOrType
      : unitOrType?.unitType || unitOrType?.unit_type || 'cage'
  const t = UNIT_TYPES.find((u) => u.value === type) || UNIT_TYPES[0]
  return plural ? t.plural : t.label
}

export const SITE_TYPES = [
  { value: 'cage_farm', label: 'Cage farm' },
  { value: 'pond_farm', label: 'Pond farm' },
  { value: 'hatchery', label: 'Hatchery' },
  { value: 'nursery', label: 'Nursery' },
  { value: 'ras_facility', label: 'RAS facility' },
  { value: 'mixed', label: 'Mixed' },
  { value: 'store', label: 'Store / warehouse' },
]
