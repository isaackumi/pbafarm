import { formatNumber, getActiveLocale } from './format'

/**
 * Numbers for the Feed & inventory overview (Paper 09): stock on hand, 30-day
 * use, days of cover per feed and which feeds need reordering.
 *
 * stockLevels: api.inventory.listStockLevels rows.
 * usageRows: api.feed.listUsage rows over `days` days.
 * Bars in the design fill at 30 days of cover (COVER_SCALE_DAYS).
 */
export const COVER_SCALE_DAYS = 30

export function buildFeedOverview(stockLevels, usageRows, days = 30) {
  const levels = (stockLevels || []).filter((row) => row.active !== false)
  const usedById = {}
  let usedKg = 0
  let costValue = 0
  const priceById = Object.fromEntries(
    (stockLevels || []).map((row) => [row.feed_type_id, Number(row.price_per_kg || 0)]),
  )
  for (const u of usageRows || []) {
    const id = u.feed_type_id || u.feedTypeId
    const qty = Number(u.quantity || 0)
    usedKg += qty
    usedById[id] = (usedById[id] || 0) + qty
    costValue += qty * (priceById[id] || 0)
  }
  const perDay = (kg) => (days > 0 ? kg / days : 0)
  const cover = (stockKg, dailyKg) => (dailyKg > 0 ? Math.max(0, stockKg / dailyKg) : null)

  const rows = levels
    .map((row) => {
      const stockKg = Number(row.current_stock || 0)
      const dailyKg = perDay(usedById[row.feed_type_id] || 0)
      const coverDays = cover(stockKg, dailyKg)
      const low = Boolean(row.is_low_stock)
      const tone = low || (coverDays != null && coverDays < 7) ? 'alert' : coverDays != null && coverDays < 14 ? 'warn' : 'good'
      return {
        id: row.feed_type_id,
        name: row.feed_type_name || '—',
        supplier: row.supplier_name || null,
        stockKg,
        minimumKg: Number(row.minimum_stock || 0),
        dailyKg,
        coverDays,
        low,
        tone,
        value: Number(row.stock_value || 0),
      }
    })
    .sort((a, b) => b.stockKg - a.stockKg)

  const totalKg = rows.reduce((sum, row) => sum + row.stockKg, 0)
  const dailyKg = perDay(usedKg)
  return {
    totalKg,
    usedKg,
    dailyKg,
    coverDays: cover(totalKg, dailyKg),
    costValue,
    costPerKg: usedKg > 0 ? costValue / usedKg : 0,
    rows,
    reorder: rows.filter((row) => row.low).sort((a, b) => (a.coverDays ?? Infinity) - (b.coverDays ?? Infinity)),
  }
}

/** "620 kg" under a tonne, "42.6 t" from a tonne up. */
export function formatMass(kg) {
  const n = Number(kg) || 0
  return Math.abs(n) >= 1000
    ? `${formatNumber(n / 1000, { decimals: 1 })} t`
    : `${formatNumber(n, { decimals: 0 })} kg`
}

/** "Nov 18" style date for a timestamp or ISO day. */
export function shortDate(value) {
  if (value == null || value === '') return '—'
  const d = typeof value === 'number' ? new Date(value) : new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return String(value)
  return new Intl.DateTimeFormat(getActiveLocale(), { month: 'short', day: 'numeric', timeZone: typeof value === 'number' ? undefined : 'UTC' }).format(d)
}

/** Ledger movement → the design's Issue / Receipt / Adjust / Transfer pill. */
export function movementKind(type) {
  if (type === 'purchase' || type === 'transfer_in') return { key: 'receipt', tone: 'green' }
  if (type === 'adjustment' || type === 'reversal') return { key: 'adjust', tone: 'amber' }
  if (type === 'transfer' || type === 'transfer_out') return { key: 'transfer', tone: 'cyan' }
  return { key: 'issue', tone: 'neutral' }
}
