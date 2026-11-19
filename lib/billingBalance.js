/** Pure billing helpers (no React, no money formatting). */

/** What open invoices still owe, per currency: [[currency, amountMinor], …] with amounts above zero. */
export function balanceDue(invoices) {
  const by = new Map()
  for (const i of invoices || []) {
    if (i.status !== 'open') continue
    by.set(i.currency, (by.get(i.currency) || 0) + Math.max(0, i.totalMinor - i.paidMinor))
  }
  return [...by].filter(([, v]) => v > 0)
}

/** Usage-bar tone for a plan limit: at/over the limit, 80%+ of it, or fine. `max: null` is unlimited. */
export function limitTone(used, max) {
  if (max === null || max === undefined) return 'ok'
  if (used >= max) return 'alert'
  return used / max >= 0.8 ? 'warn' : 'ok'
}
