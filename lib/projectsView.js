/**
 * Pure pieces of the Projects pages (Paper 20): bar tone, grouping, compact
 * money and the Ask Anowa deep link. No React.
 */

/**
 * Timeline bar fill (Paper 20): planned is a faint full bar, at risk is
 * amber, over budget red, nearly done green, otherwise the sky gradient.
 */
export function barTone(p) {
  if (p.status === 'planned') return 'planned'
  if (p.overBudget) return 'over'
  if (p.atRisk) return 'risk'
  if (p.status === 'done' || p.progressPct >= 80) return 'good'
  return 'normal'
}

export const BAR_CLASS = {
  planned: 'bg-faint',
  over: 'bg-alert',
  risk: 'bg-warn',
  good: 'bg-good',
  /** Paper 20: linear-gradient(in oklab 90deg, #1562D6 0%, #8EC2F7 100%). */
  normal: 'bg-[linear-gradient(in_oklab_90deg,#1562D6_0%,#8EC2F7_100%)]',
}

/** Tailwind dot class for a budget row: over budget red, near the line amber. */
export function budgetDot(p) {
  if (p.budgetPct == null) return 'neutral'
  if (p.overBudget) return 'alert'
  if (p.budgetPct >= 90) return 'warn'
  return 'cyan'
}

/**
 * Rows grouped for display: by 'site', 'owner', 'status' or 'none'. Groups
 * keep the rows' order and appear in order of their first row.
 */
export function groupProjects(rows, by, labels = {}) {
  if (!by || by === 'none') return [{ key: 'all', label: null, rows }]
  const groups = new Map()
  for (const r of rows) {
    const key = by === 'site' ? r.locationId || '' : by === 'owner' ? r.ownerUserId : r.status
    const label =
      by === 'site' ? r.locationName || labels.companyWide || '' : by === 'owner' ? r.ownerName : labels.status?.[r.status] || r.status
    if (!groups.has(key)) groups.set(key, { key, label, rows: [] })
    groups.get(key).rows.push(r)
  }
  return [...groups.values()]
}

/** "GH₵ 840k", "GH₵ 1.2m": compact money with the organization's symbol. */
export function compactMoney(n, symbol, locale) {
  if (!Number.isFinite(n)) return ''
  const abs = Math.abs(n)
  const fmt =
    abs >= 1e6
      ? new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 2 })
      : abs >= 1e3
        ? new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 0 })
        : new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
  return `${symbol} ${fmt.format(n)}`
}

/** A short date ("Nov 28") in the active language, read as a UTC calendar date. */
export function shortDate(iso, locale) {
  if (!iso) return ''
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

/** "Oct", "Nov": a month label for the timeline header. */
export function monthLabel(iso, locale) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { month: 'short', timeZone: 'UTC' })
}
