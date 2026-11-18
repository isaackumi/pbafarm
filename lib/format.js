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

/** Called by LocationContext when the site or organization changes. */
export function setActiveZone(zone) {
  activeZone = zone || null
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

export function formatNumber(value, { locale, decimals = 0 } = {}) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n)
}

export function formatMoney(amount, { currency = 'GHS', locale, decimals = 2 } = {}) {
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
export function formatDate(isoDate, { locale } = {}) {
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
export function formatDateTime(ms, { zone = getActiveZone(), locale } = {}) {
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
const M3_PER_FT3 = 0.028316846592
const M2_PER_FT2 = 0.09290304

/** Display a metric quantity in the organization's unit system. */
export function formatQuantity(value, kind, { unitSystem = 'metric', locale, decimals = 1 } = {}) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  const imperial = unitSystem === 'imperial'
  const table = {
    mass: imperial ? [n / KG_PER_LB, 'lb'] : [n, 'kg'],
    volume: imperial ? [n / M3_PER_FT3, 'ft³'] : [n, 'm³'],
    area: imperial ? [n / M2_PER_FT2, 'ft²'] : [n, 'm²'],
    length: imperial ? [n / 0.3048, 'ft'] : [n, 'm'],
  }
  const [v, unit] = table[kind] || [n, '']
  return `${formatNumber(v, { locale, decimals })} ${unit}`.trim()
}

/** Convert a value typed in the display unit back to metric before saving. */
export function toMetric(value, kind, unitSystem = 'metric') {
  const n = Number(value)
  if (!Number.isFinite(n) || unitSystem !== 'imperial') return n
  if (kind === 'mass') return n * KG_PER_LB
  if (kind === 'volume') return n * M3_PER_FT3
  if (kind === 'area') return n * M2_PER_FT2
  if (kind === 'length') return n * 0.3048
  return n
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
