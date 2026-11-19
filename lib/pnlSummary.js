/**
 * Paper 10 Finance P&L figures from the cage P&L rows (api.reports.listCagePnL)
 * and the farm overheads (api.reports.pnlOverheads).
 */

const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null)

/** Farm totals: revenue, cost (incl. overheads), net margin, margin % and cost per kg. */
export function summarizePnl(rows = [], overheads = null) {
  const sum = (k) => rows.reduce((s, r) => s + (r[k] || 0), 0)
  const overhead = overheads?.total || 0
  const cost = sum('total_cost') + overhead
  const revenue = sum('revenue')
  const harvestKg = sum('harvest_kg')
  const net = revenue - cost
  return {
    revenue,
    cost,
    overhead,
    feed: sum('feed_cost'),
    net,
    marginPct: revenue > 0 ? pct(net, revenue) : null,
    costPerKg: harvestKg > 0 ? cost / harvestKg : null,
  }
}

/**
 * Cost lines for the breakdown card: feed, then expense categories (cage
 * expenses plus overheads), largest first, each with its share of total cost.
 * The 'feed' expense category folds into the feed line.
 */
export function costBreakdown(rows = [], overheads = null) {
  const byKey = new Map()
  const add = (key, amount) => {
    if (!(amount > 0)) return
    byKey.set(key, (byKey.get(key) || 0) + amount)
  }
  for (const r of rows) {
    add('feed', r.feed_cost)
    for (const [k, v] of Object.entries(r.expenses_by_category || {})) add(k, v)
  }
  for (const [k, v] of Object.entries(overheads?.by_category || {})) add(k, v)
  const total = [...byKey.values()].reduce((s, v) => s + v, 0)
  return [...byKey.entries()]
    .map(([key, amount]) => ({ key, amount, pct: pct(amount, total) }))
    .sort((a, b) => b.amount - a.amount)
}

/** Revenue and cost bars for the cages with the most revenue, scaled to the tallest bar (0–1). */
export function cageBars(rows = [], limit = 6) {
  const top = [...rows]
    .filter((r) => r.revenue > 0 || r.total_cost > 0)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit)
  const max = Math.max(0, ...top.flatMap((r) => [r.revenue, r.total_cost]))
  return top.map((r) => ({
    id: r.cage_id,
    label: r.cage_name,
    revenue: r.revenue,
    cost: r.total_cost,
    revenueH: max > 0 ? r.revenue / max : 0,
    costH: max > 0 ? r.total_cost / max : 0,
  }))
}

/**
 * Paper 19 "Cost build-up per kg": each cost line over harvested kg, plus the
 * total. Empty when nothing was harvested.
 */
export function costBuildUp(rows = [], overheads = null) {
  const kg = rows.reduce((s, r) => s + (r.harvest_kg || 0), 0)
  if (!(kg > 0)) return { lines: [], total: null }
  const lines = costBreakdown(rows, overheads).map((l) => ({ key: l.key, perKg: l.amount / kg }))
  return { lines, total: lines.reduce((s, l) => s + l.perKg, 0) }
}

/** Expenses split into cage-tagged (direct) and site-wide (overhead), with shares. */
export function splitDirect(expenseRows = []) {
  let direct = 0
  let overhead = 0
  for (const r of expenseRows) {
    if (r.cage_id) direct += r.amount
    else overhead += r.amount
  }
  const total = direct + overhead
  return { direct, overhead, directPct: pct(direct, total), overheadPct: pct(overhead, total) }
}
